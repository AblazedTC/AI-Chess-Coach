import hashlib
import io
import re

import chess
import chess.pgn

from app.cache import Cache
from app.config import Settings
from app.errors import AppError
from app.models import GameDetail, Move, Position

DEMO_PGN = """[Event "Local demonstration"]
[Site "Offline"]
[Date "2024.01.01"]
[Round "1"]
[White "DemoWhite"]
[Black "DemoBlack"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4
6. cxd4 Bb4+ 7. Nc3 Nxe4 8. O-O Bxc3 9. d5 Bf6
10. Re1 Ne7 11. Rxe4 d6 12. Bg5 Bxg5 13. Nxg5 O-O 1-0
"""

_HEADER = re.compile(r'\[([A-Za-z0-9_]+)\s+"((?:[^"\\\r\n]|\\["\\])*)"\]')
_TOKEN = re.compile(
    r"\s+|;[^\r\n]*|\{[^}]*\}|\d+\.(?:\.\.)?|\$\d+|[!?]+|"
    r"1/2-1/2|1-0|0-1|\*|\(|\)|"
    r"(?:O-O-O|O-O|0-0-0|0-0|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=?[QRBN])?)[+#]?"
)


def position_key(board: chess.Board) -> str:
    # Full FEN keeps rule-50 state distinct. Identical replay positions share keys across games.
    return hashlib.sha256(board.fen().encode("ascii")).hexdigest()[:24]


def position(board: chess.Board, ply: int) -> Position:
    return Position(
        ply=ply,
        fen=board.fen(),
        position_key=position_key(board),
        turn="white" if board.turn else "black",
        in_check=board.is_check(),
    )


def _validate_text(pgn: str) -> None:
    if len(pgn) > 250_000 or not pgn.strip() or "\x00" in pgn:
        raise AppError(422, "invalid_pgn", "Provide one PGN game of at most 250,000 characters.")
    offset = 0
    headers: set[str] = set()
    text = pgn.lstrip("\ufeff")
    while True:
        offset += len(text[offset:]) - len(text[offset:].lstrip())
        match = _HEADER.match(text, offset)
        if not match:
            break
        name = match.group(1)
        if name in headers:
            raise AppError(422, "invalid_pgn", "Duplicate PGN headers are not supported.")
        headers.add(name)
        offset = match.end()
    level = 0
    result_seen = False
    for _ in range(100_000):
        if offset == len(text):
            break
        token = _TOKEN.match(text, offset)
        if not token:
            raise AppError(422, "invalid_pgn", "PGN contains malformed or unsupported notation.")
        value = token.group()
        trivia = value.isspace() or value.startswith(("{", ";"))
        if result_seen and not trivia:
            raise AppError(
                422, "invalid_pgn", "Only one game is allowed, with no moves after its result."
            )
        if level == 0 and value in {"1-0", "0-1", "1/2-1/2", "*"}:
            result_seen = True
        if value == "(":
            level += 1
        elif value == ")":
            level -= 1
        if level < 0 or level > 16:
            raise AppError(
                422, "invalid_pgn", "PGN variations are unbalanced or too deeply nested."
            )
        offset = token.end()
    if level != 0 or offset != len(text):
        raise AppError(422, "invalid_pgn", "PGN is incomplete or exceeds parsing bounds.")


class QuietGameBuilder(chess.pgn.GameBuilder[chess.pgn.Game]):
    def handle_error(self, error: Exception) -> None:
        self.game.errors.append(error)


def parse_pgn(pgn: str) -> GameDetail:
    _validate_text(pgn)
    stream = io.StringIO(pgn.lstrip("\ufeff"))
    try:
        game = chess.pgn.read_game(stream, Visitor=QuietGameBuilder)
        if game is None or game.errors or chess.pgn.read_game(stream) is not None:
            raise ValueError("Expected exactly one valid game")
        if game.headers.get("Variant", "Standard").lower() not in {"standard", "chess", "normal"}:
            raise ValueError("Only standard chess is supported")
        if game.headers.get("Result", "*") not in {"*", "1-0", "0-1", "1/2-1/2"}:
            raise ValueError("Invalid result")
        if len(game.headers) > 64 or any(len(v) > 2048 for v in game.headers.values()):
            raise ValueError("Headers exceed bounds")
        board = game.board()
        if not board.is_valid() or board.chess960:
            raise ValueError("Invalid starting position")
        positions = [position(board, 0)]
        moves: list[Move] = []
        for ply, move in enumerate(game.mainline_moves(), 1):
            if ply > 500 or not move or move not in board.legal_moves:
                raise ValueError("Invalid move or too many plies")
            moves.append(
                Move(
                    ply=ply,
                    san=board.san(move),
                    uci=move.uci(),
                    from_square=chess.square_name(move.from_square),
                    to_square=chess.square_name(move.to_square),
                )
            )
            board.push(move)
            positions.append(position(board, ply))
        # Canonical export deliberately omits comments/variations, including embedded directives.
        canonical = game.accept(
            chess.pgn.StringExporter(headers=True, variations=False, comments=False)
        )
    except (ValueError, IndexError, KeyError, RecursionError) as exc:
        raise AppError(
            422,
            "invalid_pgn",
            "PGN must contain one legal standard-chess game (at most 500 plies).",
        ) from exc
    return GameDetail(
        id=hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24],
        white=game.headers.get("White", "?"),
        black=game.headers.get("Black", "?"),
        result=game.headers.get("Result", "*"),
        headers=dict(game.headers),
        positions=positions,
        moves=moves,
        pgn=canonical,
    )


class GameStore:
    def __init__(self, settings: Settings):
        self.cache: Cache[str, GameDetail] = Cache(settings.max_games, settings.cache_ttl_seconds)

    def import_pgn(self, pgn: str) -> GameDetail:
        game = parse_pgn(pgn)
        self.cache.put(game.id, game)
        return game.model_copy(deep=True)

    def get(self, game_id: str) -> GameDetail:
        game = self.cache.get(game_id)
        if game is None:
            raise AppError(404, "game_not_found", "Game not found or expired. Import it again.")
        return game.model_copy(deep=True)

    def selected(self, game_id: str, ply: int) -> tuple[GameDetail, chess.Board]:
        game = self.get(game_id)
        if ply < 0 or ply >= len(game.positions):
            raise AppError(422, "invalid_ply", "Ply is outside this game's replay.")
        board = chess.Board(game.positions[0].fen)
        for move in game.moves[:ply]:
            board.push_uci(move.uci)
        return game, board
