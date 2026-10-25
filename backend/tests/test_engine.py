import asyncio
import os

import chess
import chess.engine
import pytest

from app.config import Settings
from app.engine import Analyzer, Engine, Evaluation, material_cp, white_score
from app.errors import AppError
from app.games import GameStore
from app.models import Score


@pytest.mark.parametrize(
    ("score", "turn", "kind", "value"),
    [
        (chess.engine.Cp(125), chess.WHITE, "cp", 125),
        (chess.engine.Cp(125), chess.BLACK, "cp", -125),
        (chess.engine.Cp(-80), chess.BLACK, "cp", 80),
        (chess.engine.Mate(3), chess.WHITE, "mate", 3),
        (chess.engine.Mate(3), chess.BLACK, "mate", -3),
        (chess.engine.Mate(-2), chess.WHITE, "mate", -2),
        (chess.engine.Mate(0), chess.BLACK, "mate", 0),
    ],
)
def test_white_score_conversion(
    score: chess.engine.Score, turn: chess.Color, kind: str, value: int
) -> None:
    assert white_score(chess.engine.PovScore(score, turn)).model_dump() == {
        "kind": kind,
        "value": value,
    }


@pytest.mark.parametrize("turn", ["w", "b"])
def test_material_perspective(turn: str) -> None:
    board = chess.Board(f"4k3/8/8/8/8/8/4P3/4K3 {turn} - - 0 1")
    assert material_cp(board) == 100
    board = chess.Board(f"4k3/4q3/8/8/8/8/8/4K3 {turn} - - 0 1")
    assert material_cp(board) == -900


class FakeProtocol:
    def __init__(self, *, hang: bool = False, bad: bool = False, startup_hang: bool = False):
        self.returncode: asyncio.Future[int] = asyncio.get_running_loop().create_future()
        self.hang = hang
        self.bad = bad
        self.startup_hang = startup_hang
        self.started = asyncio.Event()
        self.active = 0
        self.peak = 0

    async def initialize(self) -> None:
        if self.startup_hang:
            self.started.set()
            await asyncio.Event().wait()

    async def configure(self, options: dict) -> None:
        assert options["Threads"] == 1
        assert options["Hash"] == 32

    async def analyse(self, board: chess.Board, limit: object, multipv: int) -> list[dict]:
        self.started.set()
        self.active += 1
        self.peak = max(self.peak, self.active)
        try:
            if self.hang:
                await asyncio.Event().wait()
            await asyncio.sleep(0.005)
            move = chess.Move.from_uci("e2e5") if self.bad else next(iter(board.legal_moves))
            return [
                {
                    "score": chess.engine.PovScore(chess.engine.Cp(100), board.turn),
                    "depth": 7,
                    "pv": [move],
                }
            ]
        finally:
            self.active -= 1


class FakeTransport:
    def __init__(self, protocol: FakeProtocol):
        self.protocol = protocol
        self.killed = False
        self.closed = False

    def kill(self) -> None:
        self.killed = True
        if not self.protocol.returncode.done():
            self.protocol.returncode.set_result(-9)

    def close(self) -> None:
        self.closed = True


def fake_engine(
    monkeypatch: pytest.MonkeyPatch, settings: Settings, **kwargs: bool
) -> tuple[Engine, FakeTransport, FakeProtocol]:
    protocol = FakeProtocol(**kwargs)
    transport = FakeTransport(protocol)

    async def popen(_: list[str]) -> tuple[FakeTransport, FakeProtocol]:
        return transport, protocol

    monkeypatch.setattr(chess.engine.UciProtocol, "popen", popen)
    settings.engine_mode = "stockfish"
    settings.stockfish_path = "mock-stockfish"
    return Engine(settings), transport, protocol


async def test_engine_exclusive_and_shutdown(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine, transport, protocol = fake_engine(monkeypatch, settings)
    try:
        a, b = await asyncio.gather(engine.evaluate(chess.Board()), engine.evaluate(chess.Board()))
        assert a.score.value == b.score.value == 100
        assert a.best_move in [move.uci() for move in chess.Board().legal_moves]
        assert protocol.peak == 1
    finally:
        await engine.close()
    assert transport.killed and transport.closed
    assert protocol.returncode.done()


@pytest.mark.parametrize("startup", [False, True])
async def test_engine_timeout_cleanup(
    settings: Settings, monkeypatch: pytest.MonkeyPatch, startup: bool
) -> None:
    settings.engine_timeout_seconds = 0.1
    engine, transport, protocol = fake_engine(
        monkeypatch, settings, hang=not startup, startup_hang=startup
    )
    with pytest.raises(AppError) as caught:
        await engine.evaluate(chess.Board())
    assert caught.value.code == "engine_timeout"
    assert transport.killed and transport.closed
    assert protocol.returncode.done()
    assert not engine._lock.locked()


@pytest.mark.parametrize("startup", [False, True])
async def test_engine_cancel_cleanup(
    settings: Settings, monkeypatch: pytest.MonkeyPatch, startup: bool
) -> None:
    engine, transport, protocol = fake_engine(
        monkeypatch, settings, hang=not startup, startup_hang=startup
    )
    task = asyncio.create_task(engine.evaluate(chess.Board()))
    await asyncio.wait_for(protocol.started.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert transport.killed and transport.closed
    assert not engine._lock.locked()


async def test_engine_busy_does_not_kill_current(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings.engine_queue_timeout_seconds = 0.1
    engine, transport, protocol = fake_engine(monkeypatch, settings, hang=True)
    task = asyncio.create_task(engine.evaluate(chess.Board()))
    await protocol.started.wait()
    with pytest.raises(AppError) as caught:
        await engine.evaluate(chess.Board())
    assert caught.value.code == "engine_busy"
    assert not transport.killed
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)


async def test_engine_rejects_illegal_line(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine, transport, _ = fake_engine(monkeypatch, settings, bad=True)
    with pytest.raises(AppError) as caught:
        await engine.evaluate(chess.Board())
    assert caught.value.code == "engine_response"
    assert transport.killed


async def test_missing_binary(settings: Settings) -> None:
    settings.engine_mode = "stockfish"
    settings.stockfish_path = r"Z:\nonexistent\stockfish.exe"
    engine = Engine(settings)
    with pytest.raises(AppError) as caught:
        await engine.evaluate(chess.Board())
    assert caught.value.code == "engine_unavailable"
    await engine.close()


@pytest.mark.parametrize(
    ("ply", "previous", "current", "expected_loss"),
    [(1, 150, 50, 100), (2, -150, -50, 100), (1, 50, 150, 0), (2, -50, -150, 0)],
)
async def test_classification_mover_perspective(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
    ply: int,
    previous: int,
    current: int,
    expected_loss: int,
) -> None:
    settings.engine_mode = "stockfish"
    store = GameStore(settings)
    game = store.import_pgn("1. e4 e5 *")
    engine = Engine(settings)

    async def evaluate(board: chess.Board) -> Evaluation:
        score = current if len(board.move_stack) == ply else previous
        return Evaluation(Score(kind="cp", value=score), 10, [], None)

    monkeypatch.setattr(engine, "evaluate", evaluate)
    analysis = await Analyzer(settings, store, engine).analyze(game.id, ply)
    assert analysis.loss_cp == expected_loss
    assert analysis.classification == ("mistake" if expected_loss == 100 else "good")


async def test_mate_is_not_centipawn_loss(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings.engine_mode = "stockfish"
    store = GameStore(settings)
    game = store.import_pgn("1. e4 *")
    engine = Engine(settings)

    async def evaluate(_: chess.Board) -> Evaluation:
        return Evaluation(Score(kind="mate", value=3), 10, [], None)

    monkeypatch.setattr(engine, "evaluate", evaluate)
    analysis = await Analyzer(settings, store, engine).analyze(game.id, 1)
    assert analysis.score.kind == "mate"
    assert analysis.loss_cp is None
    assert analysis.classification is None


def actual_settings() -> Settings:
    path = os.environ.get("STOCKFISH_PATH")
    if not path:
        pytest.skip("STOCKFISH_PATH is unset")
    return Settings(
        _env_file=None,
        engine_mode="stockfish",
        stockfish_path=path,
        engine_depth=8,
        engine_time_seconds=0.1,
        llm_provider="deterministic",
    )


@pytest.mark.stockfish
async def test_actual_stockfish_lifecycle_pov_pv_and_mate() -> None:
    engine = Engine(actual_settings())
    transport = None
    try:
        for fen, direction in [
            ("7k/8/8/8/8/8/Q7/K7 w - - 0 1", 1),
            ("4k3/8/8/8/8/8/4Q3/4K3 b - - 0 1", 1),
            ("7k/8/6q1/8/8/8/8/K7 w - - 0 1", -1),
            ("7k/8/6q1/8/8/8/8/K7 b - - 0 1", -1),
        ]:
            board = chess.Board(fen)
            assert board.is_valid()
            result = await engine.evaluate(board)
            assert result.score.value * direction > 0
            assert result.depth is not None
            for line in result.lines:
                replay = board.copy()
                for uci, san in zip(line.uci, line.san, strict=True):
                    move = chess.Move.from_uci(uci)
                    assert move in replay.legal_moves
                    assert replay.san(move) == san
                    replay.push(move)
        mate = chess.Board("7k/5Q2/6K1/8/8/8/8/8 w - - 0 1")
        result = await engine.evaluate(mate)
        assert result.score.kind == "mate"
        assert result.score.value == 1
        terminal = chess.Board("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1")
        result = await engine.evaluate(terminal)
        assert result.score.kind == "mate" and result.score.value == 0
        assert result.best_move is None
        transport = engine._transport
        protocol = engine._protocol
        assert transport is not None and transport.get_returncode() is None
    finally:
        await engine.close()
    assert transport is not None and transport.get_returncode() is not None
    assert protocol is not None and protocol.returncode.done()


@pytest.mark.stockfish
async def test_actual_stockfish_cancellation_and_restart() -> None:
    settings = actual_settings()
    settings.engine_depth = 24
    settings.engine_time_seconds = 5
    engine = Engine(settings)
    # First warm the process with a small search, then cancel an exclusive longer one.
    settings.engine_depth = 4
    await engine.evaluate(chess.Board())
    transport = engine._transport
    assert transport is not None
    settings.engine_depth = 24
    task = asyncio.create_task(engine.evaluate(chess.Board()))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert transport.get_returncode() is not None
    assert engine._transport is None
    settings.engine_depth = 4
    try:
        result = await engine.evaluate(chess.Board())
        assert result.best_move
        assert engine._transport is not transport
    finally:
        await engine.close()
