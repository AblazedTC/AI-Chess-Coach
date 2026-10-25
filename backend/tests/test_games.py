import chess
import pytest

from app.cache import Cache
from app.config import Settings
from app.errors import AppError
from app.games import DEMO_PGN, GameStore, parse_pgn, position_key
from app.learning import practice
from app.models import PracticeRequest


@pytest.mark.parametrize(
    "text",
    [
        "",
        "This is not PGN",
        "1. e4 e5 2. Qh9 *",
        "1. e4 e5 2. Ke2 Ke7 3. Kxe5 *",
        "1. e5 *",
        "1. -- *",
        "1. e4 {unterminated",
        "1. e4 (1. d4 *",
        "1. e4 ) *",
        "1. e4 e5 * trailing",
        "1. e4 * 1. d4 *",
        '[FEN "not a fen"]\n\n*',
        '[SetUp "1"]\n[FEN "8/8/8/8/8/8/8/8 w - - 0 1"]\n\n*',
        '[Variant "Atomic"]\n\n1. e4 *',
        '[White "A"]\n[White "B"]\n\n1. e4 *',
        '[Result "invalid"]\n\n1. e4 *',
        '1. e4 *\n\n[White "B"]\n\n1. d4 *',
        "1. e4 " + "(" * 17 + "1. d4" + ")" * 17,
        "1. e4 \x00",
        " " * 250001,
    ],
    ids=lambda value: value[:60] if value.strip() else f"blank-{len(value)}",
)
def test_invalid_pgn(text: str) -> None:
    with pytest.raises(AppError) as caught:
        parse_pgn(text)
    assert caught.value.code == "invalid_pgn"


@pytest.mark.parametrize(
    "text",
    [
        "1. e4 e5 2. Nf3 Nc6 *",
        "1.e4 e5 2.Nf3 Nc6 *",
        "1. e4 {comment} e5 $1 2. Nf3!? Nc6 *",
        "1. e4 (1. d4 d5 (1... Nf6)) e5 *",
        "1. e4 ; commentary\n e5 *",
        "\ufeff" + DEMO_PGN,
        '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4 *',
    ],
)
def test_legal_pgn(text: str) -> None:
    detail = parse_pgn(text)
    board = chess.Board(detail.positions[0].fen)
    for move, pos in zip(detail.moves, detail.positions[1:], strict=True):
        assert board.san(chess.Move.from_uci(move.uci)) == move.san
        board.push_uci(move.uci)
        assert board.fen() == pos.fen
        assert position_key(board) == pos.position_key


def test_demo_canonical_stability_and_identity() -> None:
    game = parse_pgn(DEMO_PGN)
    assert len(game.moves) == 26
    assert parse_pgn(game.pgn).id == game.id
    assert parse_pgn(DEMO_PGN.replace("e4 e5", "e4 {ignored} e5")).id == game.id
    other = parse_pgn(DEMO_PGN.replace("DemoWhite", "AnotherPlayer"))
    assert other.id != game.id
    assert other.positions == game.positions
    assert game.positions[0].turn == "white"
    assert game.positions[1].turn == "black"
    assert game.moves[0].from_square == "e2"
    assert game.moves[0].to_square == "e4"
    assert game.moves[0].san == "e4"


def test_special_moves() -> None:
    game = parse_pgn("1. e4 a6 2. e5 d5 3. exd6 *")
    assert game.moves[-1].uci == "e5d6"
    assert chess.Board(game.positions[-1].fen).piece_at(chess.D5) is None
    promotion = parse_pgn('[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 1"]\n\n1. a8=Q+ *')
    assert promotion.moves[0].uci == "a7a8q"
    assert promotion.positions[-1].in_check
    assert any(move.san == "O-O" for move in parse_pgn(DEMO_PGN).moves)


def test_fen_black_start() -> None:
    game = parse_pgn('[SetUp "1"]\n[FEN "4k3/4p3/8/8/8/8/8/4K3 b - - 0 8"]\n\n8... e5 *')
    assert game.positions[0].turn == "black"
    assert game.positions[1].turn == "white"


def test_cache_lru_ttl() -> None:
    now = [0.0]
    cache: Cache[str, int] = Cache(2, 10, lambda: now[0])
    cache.put("a", 1)
    cache.put("b", 2)
    assert cache.get("a") == 1
    cache.put("c", 3)
    assert cache.get("b") is None
    assert len(cache) == 2
    now[0] = 10
    assert cache.get("a") is None
    cache.put("d", 4)
    assert len(cache) == 1
    assert cache.get("c") is None


def test_game_eviction_and_copy(settings: Settings) -> None:
    settings.max_games = 2
    store = GameStore(settings)
    a = store.import_pgn("1. e4 *")
    b = store.import_pgn("1. d4 *")
    b.white = "modified"
    assert store.get(b.id).white == "?"
    store.import_pgn("1. c4 *")
    with pytest.raises(AppError, match="not found"):
        store.get(a.id)
    with pytest.raises(AppError, match="Ply"):
        store.selected(b.id, 8)


def test_practice_repetition_and_isolation(settings: Settings) -> None:
    store = GameStore(settings)
    game = store.import_pgn("1. Nf3 Nf6 2. Ng1 Ng8 *")
    _, board = store.selected(game.id, 4)
    assert len(board.move_stack) == 4
    before = store.get(game.id)
    result = practice(
        store, PracticeRequest(game_id=game.id, ply=4, moves=["d2d4", "d7d5", "c2c4"])
    )
    assert result.fen != before.positions[4].fen
    assert store.get(game.id) == before
    assert result.moves == ["d2d4", "d7d5", "c2c4"]
    reset = practice(store, PracticeRequest(game_id=game.id, ply=4, moves=[]))
    assert reset.fen == before.positions[4].fen


def test_mainline_bound() -> None:
    board = chess.Board()
    tokens = []
    for i in range(504):
        uci = ("g1f3", "g8f6", "f3g1", "f6g8")[i % 4]
        move = chess.Move.from_uci(uci)
        if i % 2 == 0:
            tokens.append(f"{i // 2 + 1}.")
        tokens.append(board.san(move))
        board.push(move)
    with pytest.raises(AppError):
        parse_pgn(" ".join(tokens) + " *")
