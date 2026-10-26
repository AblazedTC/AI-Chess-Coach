import asyncio
import json

import httpx
import pytest
from pydantic import SecretStr, ValidationError

from app.chesscom import ChessCom
from app.coach import Coach
from app.config import Settings
from app.engine import Analyzer, Engine
from app.errors import AppError
from app.games import DEMO_PGN, GameStore
from app.models import CoachRequest


def live(settings: Settings) -> Settings:
    settings.chesscom_mode = "live"
    settings.http_min_interval_seconds = 0
    return settings


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (404, "player_not_found"),
        (429, "provider_rate_limited"),
        (500, "provider_unavailable"),
        (301, "provider_unavailable"),
    ],
)
async def test_chesscom_http_errors(settings: Settings, status: int, code: str) -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(status))
    ) as client:
        service = ChessCom(live(settings), GameStore(settings), client)
        with pytest.raises(AppError) as caught:
            await service.profile("valid-user")
        assert caught.value.code == code


@pytest.mark.parametrize(
    "body", [b"not json", b"[]", b"null", b"x" * 4_000_001], ids=["text", "array", "null", "large"]
)
async def test_chesscom_invalid_data(settings: Settings, body: bytes) -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, content=body))
    ) as client:
        service = ChessCom(live(settings), GameStore(settings), client)
        with pytest.raises(AppError) as caught:
            await service.profile("valid")
        assert caught.value.status == 502


async def test_chesscom_timeout(settings: Settings) -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("private provider credentials")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        service = ChessCom(live(settings), GameStore(settings), client)
        with pytest.raises(AppError) as caught:
            await service.profile("valid")
        assert caught.value.code == "provider_timeout"
        assert "credentials" not in caught.value.message


async def test_chesscom_cache_serial_and_profile(settings: Settings) -> None:
    calls = []
    active = 0
    peak = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        calls.append(str(request.url))
        await asyncio.sleep(0.005)
        active -= 1
        if request.url.path.endswith("/stats"):
            return httpx.Response(200, json={"chess_rapid": {"last": {"rating": 1500}}})
        return httpx.Response(
            200,
            json={"name": "Public Name", "avatar": "https://images.chesscomfiles.com/test.png"},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        service = ChessCom(live(settings), GameStore(settings), client)
        a, b = await asyncio.gather(service.profile("USER"), service.profile("user"))
        assert a == b
        assert a.rating == 1500
        assert a.name == "Public Name"
        assert a.avatar == "https://images.chesscomfiles.com/test.png"
        assert len(calls) == 2
        assert peak == 1


async def test_chesscom_recent_games_url_allowlist(settings: Settings) -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if request.url.path.endswith("/archives"):
            return httpx.Response(
                200,
                json={
                    "archives": [
                        "http://localhost/secrets",
                        "https://api.chess.com/pub/player/other/games/2024/01",
                        "https://api.chess.com/pub/player/test/games/2024/01",
                        "https://api.chess.com/pub/player/test/games/2024/02",
                        "https://api.chess.com/pub/player/test/games/2024/03",
                    ]
                },
            )
        return httpx.Response(
            200,
            json={
                "games": [
                    {"pgn": "invalid", "rules": "chess"},
                    {"pgn": DEMO_PGN, "rules": "atomic"},
                    {
                        "pgn": DEMO_PGN,
                        "rules": "chess",
                        "end_time": 1700000000,
                        "time_control": "600",
                        "url": "https://www.chess.com/game/live/123",
                    },
                    {"pgn": DEMO_PGN, "rules": "chess"},
                ]
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        store = GameStore(settings)
        service = ChessCom(live(settings), store, client)
        result = await service.recent_games("TEST")
        assert len(result.games) == 1
        assert store.get(result.games[0].id).pgn
        assert len(calls) == 3
        assert all("2024/01" not in url and "other" not in url for url in calls)


@pytest.mark.parametrize("data", [{}, {"archives": "bad"}, {"archives": []}])
async def test_chesscom_archives_schema(settings: Settings, data: dict) -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=data))
    ) as client:
        service = ChessCom(live(settings), GameStore(settings), client)
        if data == {"archives": []}:
            assert (await service.recent_games("test")).games == []
        else:
            with pytest.raises(AppError):
                await service.recent_games("test")


def anthropic(settings: Settings) -> Settings:
    settings.llm_provider = "anthropic"
    settings.anthropic_api_key = SecretStr("test-not-a-real-key")
    return settings


async def call_coach(settings: Settings, handler: object) -> tuple[dict, list[httpx.Request]]:
    calls: list[httpx.Request] = []

    def recording(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)  # type: ignore[operator]

    async with httpx.AsyncClient(transport=httpx.MockTransport(recording)) as client:
        store = GameStore(settings)
        game = store.import_pgn(DEMO_PGN)
        engine = Engine(settings)
        service = Coach(settings, store, Analyzer(settings, store, engine), client)
        result = await service.respond(
            CoachRequest(game_id=game.id, ply=0, question="What is the material balance?")
        )
        return result.model_dump(), calls


async def test_anthropic_structured_evidence(settings: Settings) -> None:
    draft = {
        "explanation": [
            {
                "text": "The material balance is equal, but development still matters.",
                "evidence_ids": [2],
            }
        ],
        "takeaway": {
            "text": "Develop minor pieces and contest the center.",
            "evidence_ids": [4],
        },
        "move_uci": ["a2a3"],
    }
    body = {
        "stop_reason": "tool_use",
        "content": [{"type": "tool_use", "name": "explain_position", "input": draft}],
    }
    response, calls = await call_coach(
        anthropic(settings), lambda _: httpx.Response(200, json=body)
    )
    assert response["mode"] == "anthropic"
    assert response["message"].startswith("The material balance")
    assert response["suggested_moves"] == [{"san": "a3", "uci": "a2a3", "engine_verified": False}]
    assert "material-only" in response["warning"]
    request = calls[0]
    assert str(request.url) == "https://api.anthropic.com/v1/messages"
    assert request.headers["anthropic-version"] == "2023-06-01"
    assert request.headers["x-api-key"] == "test-not-a-real-key"
    payload = json.loads(request.content)
    assert payload["max_tokens"] == 1400
    assert payload["tool_choice"] == {"type": "tool", "name": "explain_position"}
    assert payload["messages"][0]["role"] == "user"
    evidence = json.loads(payload["messages"][0]["content"])["evidence"]
    assert evidence["4"]["kind"] == "board"
    assert evidence["4"]["lesson"]
    assert "Teach ideas, not evaluation-bar changes" in payload["system"]


@pytest.mark.parametrize(
    "body",
    [
        {"stop_reason": "max_tokens", "content": []},
        {"stop_reason": "refusal", "content": []},
        {
            "stop_reason": "tool_use",
            "content": [{"type": "tool_use", "name": "execute_move", "input": {}}],
        },
        {
            "stop_reason": "tool_use",
            "content": [{"type": "tool_use", "name": "explain_position"}],
        },
    ],
)
async def test_incomplete_or_unexpected_coaching_tools_fall_back(
    settings: Settings, body: dict
) -> None:
    response, _ = await call_coach(anthropic(settings), lambda _: httpx.Response(200, json=body))
    assert response["mode"] == "deterministic"
    assert response["warning"]


async def test_anthropic_repairs_one_invalid_draft(settings: Settings) -> None:
    attempts = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        draft = {
            "explanation": [
                {
                    "text": "White is to move.",
                    "evidence_ids": [999] if attempts == 1 else [1],
                }
            ],
            "takeaway": {"text": "Develop minor pieces.", "evidence_ids": [4]},
            "move_uci": [],
        }
        return httpx.Response(
            200,
            json={
                "stop_reason": "tool_use",
                "content": [{"type": "tool_use", "name": "explain_position", "input": draft}],
            },
        )

    response, calls = await call_coach(anthropic(settings), handler)
    assert response["mode"] == "anthropic"
    assert len(calls) == 2
    repair = json.loads(calls[1].content)["messages"][-1]["content"]
    assert "Unknown evidence" in repair
    assert "test-not-a-real-key" not in repair


@pytest.mark.parametrize(
    "selection",
    [
        {"evidence_ids": [999], "move_uci": []},
        {"evidence_ids": [True], "move_uci": []},
        {"evidence_ids": [1], "move_uci": ["e2e5"]},
        {"evidence_ids": [1], "move_uci": ["e2e4"]},  # Legal but not supplied evidence.
        {"evidence_ids": [], "move_uci": []},
        {"evidence_ids": [1], "move_uci": [], "message": "fabricated"},
        {"evidence_ids": [1], "move_uci": [], "citations": ["fake"]},
        "free-form invented analysis",
    ],
)
async def test_anthropic_unsupported_output_falls_back(
    settings: Settings, selection: dict | str
) -> None:
    body = {
        "stop_reason": "end_turn",
        "content": [{"type": "text", "text": json.dumps(selection)}],
    }
    result, _ = await call_coach(anthropic(settings), lambda _: httpx.Response(200, json=body))
    assert result["mode"] == "deterministic"
    assert "fallback" not in result["message"]  # No untrusted provider text displayed.
    assert "using the deterministic coach" in result["warning"]


@pytest.mark.parametrize(
    "change",
    [
        {"explanation": [{"text": "White is to move.", "evidence_ids": [999]}]},
        {"explanation": [{"text": "White is to move.", "evidence_ids": [True]}]},
        {"move_uci": ["e2e5"]},
        {"move_uci": ["e2e4"]},  # Legal, but absent from the supplied suggestions.
        {"explanation": [{"text": "Qh5 wins a piece.", "evidence_ids": [1]}]},
        {"explanation": [{"text": "White's queen on e4 is safe.", "evidence_ids": [1]}]},
        {"explanation": [{"text": "This creates a fork.", "evidence_ids": [4]}]},
        {"explanation": [{"text": "You always neglect development.", "evidence_ids": [4]}]},
        {"takeaway": {"text": "Think about the position.", "evidence_ids": [1]}},
        {"citations": ["fake"]},
    ],
)
async def test_ungrounded_coaching_explanation_falls_back(settings: Settings, change: dict) -> None:
    draft = {
        "explanation": [{"text": "White is to move.", "evidence_ids": [1]}],
        "takeaway": {"text": "Develop minor pieces.", "evidence_ids": [4]},
        "move_uci": [],
        **change,
    }
    body = {
        "stop_reason": "end_turn",
        "content": [{"type": "text", "text": json.dumps(draft)}],
    }
    response, calls = await call_coach(
        anthropic(settings), lambda _: httpx.Response(200, json=body)
    )
    assert response["mode"] == "deterministic"
    assert len(calls) == 2
    assert response["warning"]
    assert "Qh5" not in response["message"]
    assert "queen on e4" not in response["message"]


@pytest.mark.parametrize("status", [401, 429, 500])
async def test_anthropic_provider_failure(settings: Settings, status: int) -> None:
    result, _ = await call_coach(anthropic(settings), lambda _: httpx.Response(status))
    assert result["mode"] == "deterministic"
    assert result["warning"]
    assert "test-not-a-real-key" not in json.dumps(result)


async def test_anthropic_timeout(settings: Settings) -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("private")

    result, _ = await call_coach(anthropic(settings), handler)
    assert result["mode"] == "deterministic"


@pytest.mark.parametrize(
    "kwargs",
    [
        {"engine_mode": "stockfish", "stockfish_path": None},
        {"llm_provider": "anthropic", "anthropic_api_key": None},
        {"llm_provider": "anthropic", "anthropic_api_key": ""},
        {"engine_depth": 100},
        {"cors_origins": ["*"]},
        {"cors_origins": ["https://evil.invalid"]},
        {"cors_origins": ["http://localhost:3000/path"]},
        {"max_active_jobs": 3, "max_jobs": 2},
    ],
)
def test_config_validation(kwargs: dict) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **kwargs)
