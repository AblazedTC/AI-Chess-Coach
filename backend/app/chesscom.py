import asyncio
import json
import logging
import re
import time
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.cache import Cache
from app.config import Settings
from app.errors import AppError
from app.games import DEMO_PGN, GameStore
from app.models import GameList, GameSummary, Player

_USERNAME = re.compile(r"^[A-Za-z0-9_-]{1,25}$")
_ARCHIVE = re.compile(r"^https://api\.chess\.com/pub/player/[a-z0-9_-]{1,25}/games/\d{4}/\d{2}$")
logger = logging.getLogger(__name__)


def username_checked(username: str) -> str:
    if not _USERNAME.fullmatch(username):
        raise AppError(422, "invalid_username", "Username must be 1–25 letters, digits, _ or -.")
    return username.lower()


def _public_url(value: Any) -> str | None:
    if not isinstance(value, str) or len(value) > 2048:
        return None
    parsed = urlsplit(value)
    if parsed.scheme != "https" or parsed.username or parsed.password:
        return None
    if parsed.hostname not in {"www.chess.com", "chess.com", "images.chesscomfiles.com"}:
        return None
    return value


class ChessCom:
    def __init__(self, settings: Settings, games: GameStore, client: httpx.AsyncClient):
        self.settings = settings
        self.games = games
        self.client = client
        self.cache: Cache[str, dict[str, Any]] = Cache(64, 300)
        self._lock = asyncio.Lock()
        self._last_request = 0.0

    async def _json(self, url: str) -> dict[str, Any]:
        cached = self.cache.get(url)
        if cached is not None:
            return cached
        try:
            async with asyncio.timeout(30):
                async with self._lock:
                    cached = self.cache.get(url)
                    if cached is not None:
                        return cached
                    delay = self.settings.http_min_interval_seconds - (
                        time.monotonic() - self._last_request
                    )
                    if delay > 0:
                        await asyncio.sleep(delay)
                    self._last_request = time.monotonic()
                    async with self.client.stream(
                        "GET", url, timeout=self.settings.http_timeout_seconds
                    ) as response:
                        if response.status_code == 404:
                            raise AppError(404, "player_not_found", "Chess.com player not found.")
                        if response.status_code == 429:
                            raise AppError(
                                503, "provider_rate_limited", "Chess.com is rate limited."
                            )
                        response.raise_for_status()
                        chunks = bytearray()
                        async for chunk in response.aiter_bytes():
                            chunks.extend(chunk)
                            if len(chunks) > 4_000_000:
                                raise AppError(
                                    502,
                                    "provider_response_too_large",
                                    "Chess.com response is too large.",
                                )
                    result = json.loads(chunks)
                    if not isinstance(result, dict):
                        raise ValueError("Expected object")
                    self.cache.put(url, result)
                    return result
        except (httpx.TimeoutException, TimeoutError) as exc:
            raise AppError(504, "provider_timeout", "Chess.com did not respond in time.") from exc
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            raise AppError(
                502, "provider_unavailable", "Chess.com returned an invalid response."
            ) from exc

    async def profile(self, username: str) -> Player:
        name = username_checked(username)
        if self.settings.chesscom_mode == "demo":
            return Player(username=name, name="Demo Player", rating=1200)
        data = await self._json(f"https://api.chess.com/pub/player/{name}")
        stats = await self._json(f"https://api.chess.com/pub/player/{name}/stats")
        rating = None
        for category in ("chess_rapid", "chess_blitz", "chess_bullet"):
            category_data = stats.get(category)
            if isinstance(category_data, dict):
                last = category_data.get("last")
                candidate = last.get("rating") if isinstance(last, dict) else None
                if (
                    isinstance(candidate, int)
                    and not isinstance(candidate, bool)
                    and 0 < candidate < 10000
                ):
                    rating = candidate
                    break
        return Player(
            username=name,
            name=data["name"][:200] if isinstance(data.get("name"), str) else None,
            rating=rating,
            avatar=_public_url(data.get("avatar")),
        )

    async def recent_games(self, username: str) -> GameList:
        name = username_checked(username)
        if self.settings.chesscom_mode == "demo":
            game = self.games.import_pgn(DEMO_PGN)
            return GameList(
                games=[
                    GameSummary(
                        id=game.id,
                        white=game.white,
                        black=game.black,
                        result=game.result,
                        end_time=1704067200,
                        time_control="600",
                    )
                ]
            )
        data = await self._json(f"https://api.chess.com/pub/player/{name}/games/archives")
        archives = data.get("archives")
        if not isinstance(archives, list) or len(archives) > 2000:
            raise AppError(502, "provider_unavailable", "Chess.com returned invalid game archives.")
        urls = sorted(
            {
                url
                for url in archives
                if isinstance(url, str) and _ARCHIVE.fullmatch(url) and url.split("/")[5] == name
            },
            reverse=True,
        )[:2]
        summaries: list[GameSummary] = []
        seen: set[str] = set()
        for url in urls:
            archive = await self._json(url)
            entries = archive.get("games")
            if not isinstance(entries, list):
                raise AppError(502, "provider_unavailable", "Chess.com returned invalid games.")
            # The provider orders monthly games chronologically; scan only a bounded recent tail.
            for entry in reversed(entries[-100:]):
                if not isinstance(entry, dict) or entry.get("rules", "chess") != "chess":
                    continue
                pgn = entry.get("pgn")
                if not isinstance(pgn, str):
                    continue
                try:
                    game = self.games.import_pgn(pgn)
                except AppError as exc:
                    logger.warning("Skipped invalid Chess.com game code=%s", exc.code)
                    continue
                if game.id in seen:
                    continue
                seen.add(game.id)
                end_time = entry.get("end_time")
                control = entry.get("time_control")
                summaries.append(
                    GameSummary(
                        id=game.id,
                        white=game.white,
                        black=game.black,
                        result=game.result,
                        end_time=end_time if type(end_time) is int else None,
                        time_control=control[:80] if isinstance(control, str) else None,
                        url=_public_url(entry.get("url")),
                    )
                )
                if len(summaries) == 20:
                    return GameList(games=summaries)
        return GameList(games=summaries)
