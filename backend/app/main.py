import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from contextvars import ContextVar

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.chesscom import ChessCom
from app.coach import Coach
from app.config import Settings
from app.engine import Analyzer, Engine
from app.errors import AppError
from app.games import DEMO_PGN, GameStore
from app.jobs import Jobs
from app.learning import insights, practice
from app.models import (
    AnalysisJob,
    CoachRequest,
    CoachResponse,
    ErrorResponse,
    GameDetail,
    GameList,
    Health,
    ImportRequest,
    InsightRequest,
    Insights,
    JobRequest,
    Player,
    PositionAnalysis,
    PositionRequest,
    PracticeRequest,
    PracticeResponse,
)

request_id_context: ContextVar[str] = ContextVar("request_id", default="")


def error_response(status: int, code: str, message: str, request_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message}, "request_id": request_id},
        headers={"X-Request-ID": request_id, "Cache-Control": "no-store"},
    )


class LocalCORS(CORSMiddleware):
    def preflight_response(self, request_headers: Headers) -> Response:
        response = super().preflight_response(request_headers)
        if response.status_code >= 400:
            return error_response(
                400,
                "cors_rejected",
                "This origin or method is not allowed.",
                request_id_context.get(),
            )
        return response


class RequestLimits:
    def __init__(self, app: ASGIApp, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes
        self.active = 0

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = uuid.uuid4().hex
        token = request_id_context.set(request_id)
        scope.setdefault("state", {})["request_id"] = request_id
        started = False

        async def with_id(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                message["headers"] = [
                    *[
                        item
                        for item in message.get("headers", [])
                        if item[0].lower() not in {b"x-request-id", b"cache-control"}
                    ],
                    (b"x-request-id", request_id.encode()),
                    (b"cache-control", b"no-store"),
                    (b"x-content-type-options", b"nosniff"),
                ]
            await send(message)

        if self.active >= 32:
            try:
                await error_response(
                    429, "request_limit", "Too many concurrent requests.", request_id
                )(scope, receive, with_id)
            finally:
                request_id_context.reset(token)
            return
        self.active += 1
        try:
            content_length = Headers(scope=scope).get("content-length")
            if content_length is not None:
                try:
                    length = int(content_length)
                except ValueError as exc:
                    raise AppError(400, "invalid_request", "Invalid Content-Length.") from exc
                if length < 0:
                    raise AppError(400, "invalid_request", "Invalid Content-Length.")
                if length > self.max_bytes:
                    raise AppError(413, "request_too_large", "Request body exceeds the size limit.")
            body = bytearray()
            async with asyncio.timeout(10):
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return
                    body.extend(message.get("body", b""))
                    if len(body) > self.max_bytes:
                        raise AppError(
                            413, "request_too_large", "Request body exceeds the size limit."
                        )
                    if not message.get("more_body", False):
                        break
            consumed = False

            async def replay() -> Message:
                nonlocal consumed
                if not consumed:
                    consumed = True
                    return {"type": "http.request", "body": bytes(body), "more_body": False}
                return await receive()

            await self.app(scope, replay, with_id)
        except AppError as exc:
            if not started:
                await error_response(exc.status, exc.code, exc.message, request_id)(
                    scope, receive, with_id
                )
        except TimeoutError:
            if not started:
                await error_response(408, "request_timeout", "Request body timed out.", request_id)(
                    scope, receive, with_id
                )
        except Exception:
            if not started:
                await error_response(
                    500, "internal_error", "An unexpected server error occurred.", request_id
                )(scope, receive, with_id)
        finally:
            self.active -= 1
            request_id_context.reset(token)


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        games = GameStore(config)
        games.import_pgn(DEMO_PGN)
        engine = Engine(config)
        client = httpx.AsyncClient(
            follow_redirects=False,
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=2),
            headers={"User-Agent": "ChessCoach/0.1 (local-first chess study application)"},
        )
        analyzer = Analyzer(config, games, engine)
        jobs = Jobs(config, games, analyzer)
        app.state.games = games
        app.state.engine = engine
        app.state.analyzer = analyzer
        app.state.jobs = jobs
        app.state.chesscom = ChessCom(config, games, client)
        app.state.coach = Coach(config, games, analyzer, client)
        try:
            yield
        finally:
            await jobs.close()
            await engine.close()
            await client.aclose()

    app = FastAPI(
        title="Chess Coach API",
        version="0.1.0",
        description=(
            "Offline-first chess study. Scores use White POV; demo scores measure material only. "
            "Position identity is the SHA-256 prefix of full FEN. "
            "Data is in bounded, expiring process-local memory."
        ),
        lifespan=lifespan,
        responses={
            status: {"model": ErrorResponse}
            for status in (400, 404, 405, 408, 413, 422, 429, 500, 502, 503, 504)
        },
    )
    app.state.settings = config
    app.add_middleware(
        LocalCORS,
        allow_origins=config.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type"],
        expose_headers=["X-Request-ID"],
    )
    app.add_middleware(RequestLimits, max_bytes=config.max_request_bytes)

    @app.exception_handler(AppError)
    async def app_error(request: Request, exc: AppError) -> JSONResponse:
        return error_response(exc.status, exc.code, exc.message, request.state.request_id)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return error_response(
            422,
            "validation_error",
            "Request fields are invalid, missing, or exceed allowed bounds.",
            request.state.request_id,
        )

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        return error_response(
            exc.status_code,
            "not_found" if exc.status_code == 404 else "http_error",
            "Endpoint not found."
            if exc.status_code == 404
            else "This HTTP request is not supported.",
            request.state.request_id,
        )

    @app.exception_handler(Exception)
    async def unexpected(request: Request, exc: Exception) -> JSONResponse:
        return error_response(
            500, "internal_error", "An unexpected server error occurred.", request.state.request_id
        )

    @app.get("/api/health", response_model=Health)
    async def health() -> Health:
        return Health(engine_mode=config.engine_mode, coach_mode=config.llm_provider)

    @app.get("/api/demo", response_model=GameDetail)
    async def demo(request: Request) -> GameDetail:
        return request.app.state.games.import_pgn(DEMO_PGN)  # type: ignore[no-any-return]

    @app.get("/api/players/{username}", response_model=Player)
    async def player(username: str, request: Request) -> Player:
        return await request.app.state.chesscom.profile(username)  # type: ignore[no-any-return]

    @app.get("/api/players/{username}/games", response_model=GameList)
    async def player_games(username: str, request: Request) -> GameList:
        return await request.app.state.chesscom.recent_games(username)  # type: ignore[no-any-return]

    @app.post("/api/games/import", response_model=GameDetail)
    async def import_game(body: ImportRequest, request: Request) -> GameDetail:
        return request.app.state.games.import_pgn(body.pgn)  # type: ignore[no-any-return]

    @app.get("/api/games/{game_id}", response_model=GameDetail)
    async def game(game_id: str, request: Request) -> GameDetail:
        return request.app.state.games.get(game_id)  # type: ignore[no-any-return]

    @app.post("/api/analysis/position", response_model=PositionAnalysis)
    async def analyze(body: PositionRequest, request: Request) -> PositionAnalysis:
        return await request.app.state.analyzer.analyze(body.game_id, body.ply)  # type: ignore[no-any-return]

    @app.post("/api/analysis/jobs", response_model=AnalysisJob)
    async def create_job(body: JobRequest, request: Request) -> AnalysisJob:
        return request.app.state.jobs.create(body.game_id)  # type: ignore[no-any-return]

    @app.get("/api/analysis/jobs/{job_id}", response_model=AnalysisJob)
    async def get_job(job_id: str, request: Request) -> AnalysisJob:
        return request.app.state.jobs.get(job_id)  # type: ignore[no-any-return]

    @app.delete("/api/analysis/jobs/{job_id}", response_model=AnalysisJob)
    async def cancel_job(job_id: str, request: Request) -> AnalysisJob:
        return await request.app.state.jobs.cancel(job_id)  # type: ignore[no-any-return]

    @app.post("/api/coach", response_model=CoachResponse)
    async def coach(body: CoachRequest, request: Request) -> CoachResponse:
        return await request.app.state.coach.respond(body)  # type: ignore[no-any-return]

    @app.post("/api/practice", response_model=PracticeResponse)
    async def practice_moves(body: PracticeRequest, request: Request) -> PracticeResponse:
        return practice(request.app.state.games, body)

    @app.post("/api/insights", response_model=Insights)
    async def game_insights(body: InsightRequest, request: Request) -> Insights:
        return insights(request.app.state.games, body)

    return app
