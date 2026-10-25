import asyncio
from dataclasses import dataclass
from typing import Literal

import chess
import chess.engine

from app.cache import Cache
from app.config import Settings
from app.errors import AppError
from app.games import GameStore
from app.models import AnalysisLine, PositionAnalysis, Score

MATERIAL = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
}


def material_cp(board: chess.Board) -> int:
    return sum(
        value * (len(board.pieces(piece, chess.WHITE)) - len(board.pieces(piece, chess.BLACK)))
        for piece, value in MATERIAL.items()
    )


def white_score(value: chess.engine.PovScore) -> Score:
    score = value.white()
    mate = score.mate()
    if mate is not None:
        return Score(kind="mate", value=mate)
    cp = score.score()
    if cp is None:
        raise AppError(502, "engine_response", "Engine returned no usable score.")
    return Score(kind="cp", value=cp)


def _rank(score: Score) -> int:
    if score.kind == "cp":
        return max(-90_000, min(90_000, score.value))
    if score.value == 0:
        return 0
    return (100_000 - min(abs(score.value), 999)) * (1 if score.value > 0 else -1)


@dataclass
class Evaluation:
    score: Score
    depth: int | None
    lines: list[AnalysisLine]
    best_move: str | None


class Engine:
    """One native UCI child, one exclusive analysis, bounded wait and hard cleanup."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self._lock = asyncio.Lock()
        self._transport: asyncio.SubprocessTransport | None = None
        self._protocol: chess.engine.UciProtocol | None = None

    async def _discard(self) -> None:
        transport, protocol = self._transport, self._protocol
        self._transport = None
        self._protocol = None
        if transport is not None:
            try:
                transport.kill()
            except ProcessLookupError:
                pass
            finally:
                transport.close()
        if protocol is not None:
            try:
                await asyncio.wait_for(asyncio.shield(protocol.returncode), timeout=2)
            except (TimeoutError, chess.engine.EngineError):
                pass

    async def close(self) -> None:
        async with self._lock:
            await self._discard()

    def demo(self, board: chess.Board) -> Evaluation:
        score = Score(kind="cp", value=material_cp(board))
        # Lexicographic legality examples, NOT an ordering of move quality.
        examples = sorted(board.legal_moves, key=lambda move: move.uci())[:3]
        lines = [
            AnalysisLine(uci=[move.uci()], san=[board.san(move)], score=score) for move in examples
        ]
        return Evaluation(score, None, lines, None)

    async def evaluate(self, board: chess.Board) -> Evaluation:
        if self.settings.engine_mode == "demo":
            await asyncio.sleep(0)
            return self.demo(board)
        try:
            await asyncio.wait_for(self._lock.acquire(), self.settings.engine_queue_timeout_seconds)
        except TimeoutError as exc:
            raise AppError(503, "engine_busy", "The engine is busy. Try again shortly.") from exc
        try:
            async with asyncio.timeout(self.settings.engine_timeout_seconds):
                if self._protocol is None:
                    assert self.settings.stockfish_path is not None
                    self._transport, self._protocol = await chess.engine.UciProtocol.popen(
                        [self.settings.stockfish_path]
                    )
                    await self._protocol.initialize()
                    await self._protocol.configure(
                        {
                            "Threads": self.settings.engine_threads,
                            "Hash": self.settings.engine_hash_mb,
                        }
                    )
                infos = await self._protocol.analyse(
                    board,
                    chess.engine.Limit(
                        depth=self.settings.engine_depth, time=self.settings.engine_time_seconds
                    ),
                    multipv=min(3, max(1, board.legal_moves.count())),
                )
                if not infos or "score" not in infos[0]:
                    raise AppError(502, "engine_response", "Engine returned no usable score.")
                lines: list[AnalysisLine] = []
                for info in infos[:3]:
                    if "score" not in info:
                        continue
                    replay = board.copy()
                    uci: list[str] = []
                    san: list[str] = []
                    for move in info.get("pv", [])[:32]:
                        if move not in replay.legal_moves:
                            raise AppError(
                                502, "engine_response", "Engine returned an illegal line."
                            )
                        uci.append(move.uci())
                        san.append(replay.san(move))
                        replay.push(move)
                    lines.append(AnalysisLine(uci=uci, san=san, score=white_score(info["score"])))
                best = lines[0].uci[0] if lines and lines[0].uci else None
                return Evaluation(
                    white_score(infos[0]["score"]), infos[0].get("depth"), lines, best
                )
        except asyncio.CancelledError:
            await self._discard()
            raise
        except TimeoutError as exc:
            await self._discard()
            raise AppError(
                504, "engine_timeout", "Engine analysis exceeded its time limit."
            ) from exc
        except (OSError, chess.engine.EngineError) as exc:
            await self._discard()
            raise AppError(
                503, "engine_unavailable", "Stockfish is unavailable. Check local setup."
            ) from exc
        except AppError:
            await self._discard()
            raise
        finally:
            self._lock.release()


class Analyzer:
    def __init__(self, settings: Settings, games: GameStore, engine: Engine):
        self.settings = settings
        self.games = games
        self.engine = engine
        self.cache: Cache[tuple[str, int], Evaluation] = Cache(
            settings.max_positions, settings.cache_ttl_seconds
        )

    async def _evaluation(self, game_id: str, ply: int, board: chess.Board) -> Evaluation:
        cached = self.cache.get((game_id, ply))
        if cached is not None:
            return cached
        value = await self.engine.evaluate(board)
        self.cache.put((game_id, ply), value)
        return value

    async def analyze(self, game_id: str, ply: int) -> PositionAnalysis:
        game, board = self.games.selected(game_id, ply)
        current = await self._evaluation(game_id, ply, board)
        classification: Literal["best", "good", "inaccuracy", "mistake", "blunder"] | None = None
        loss = None
        if self.settings.engine_mode == "stockfish" and ply > 0:
            _, previous_board = self.games.selected(game_id, ply - 1)
            previous = await self._evaluation(game_id, ply - 1, previous_board)
            direction = 1 if previous_board.turn == chess.WHITE else -1
            loss = max(0, direction * (_rank(previous.score) - _rank(current.score)))
            actual = game.moves[ply - 1].uci
            classification = (
                "best"
                if previous.best_move == actual
                else "good"
                if loss < 50
                else "inaccuracy"
                if loss < 100
                else "mistake"
                if loss < 200
                else "blunder"
            )
            # Mate distances are not centipawns: never manufacture a numeric CP loss.
            if previous.score.kind == "mate" or current.score.kind == "mate":
                loss = None
                classification = "best" if previous.best_move == actual else None
        return PositionAnalysis(
            game_id=game_id,
            ply=ply,
            position_key=game.positions[ply].position_key,
            source=self.settings.engine_mode,
            score=current.score.model_copy(),
            depth=current.depth,
            lines=[line.model_copy(deep=True) for line in current.lines],
            best_move=current.best_move,
            classification=classification,
            loss_cp=loss,
        )
