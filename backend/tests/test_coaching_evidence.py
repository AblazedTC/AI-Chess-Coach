import chess
import httpx
import pytest

from app.coach import (
    Coach,
    CoachingDraft,
    Evidence,
    validate_explanation,
)
from app.coaching_evidence import (
    capture_facts,
    line_fact,
    move_fundamentals,
    position_facts,
)
from app.config import Settings
from app.engine import Analyzer, Engine, Evaluation
from app.games import GameStore
from app.models import AnalysisLine, CoachRequest, Score


def test_central_pawn_advance_is_not_claimed_to_be_best() -> None:
    facts = move_fundamentals(chess.Board(), chess.Move.from_uci("e2e4"))
    statements = " ".join(fact.statement for fact in facts)
    assert "central square e4" in statements
    assert "central squares: d5" in statements
    assert "best" not in statements
    assert all(fact.lesson for fact in facts)


@pytest.mark.parametrize(
    ("moves", "uci", "pawn"),
    [
        ("e4 e5", "b1c3", "White's pawn on e4"),
        ("e4 e5 Nf3", "b8c6", "Black's pawn on e5"),
    ],
)
def test_development_can_add_a_central_pawn_defender(moves: str, uci: str, pawn: str) -> None:
    board = chess.Board()
    for san in moves.split():
        board.push_san(san)
    facts = move_fundamentals(board, chess.Move.from_uci(uci))
    assert any("as a defender" in fact.statement and pawn in fact.statement for fact in facts)
    assert any("off the back rank" in fact.statement for fact in facts)


LOOSE_PAWN_FEN = "6k1/8/5n2/8/4P3/3Q4/8/1N4K1 w - - 0 10"


def test_moving_the_last_defender_exposes_a_concrete_capture() -> None:
    board = chess.Board(LOOSE_PAWN_FEN)
    move = chess.Move.from_uci("d3f1")
    facts = move_fundamentals(board, move)
    assert any("last geometric defender of White's pawn on e4" in f.statement for f in facts)
    board.push(move)
    captures = capture_facts(board)
    assert any("Nxe4" in fact.statement and "undefended" in fact.statement for fact in captures)
    assert all("does not prove" in fact.statement for fact in captures)


def test_removing_an_unthreatened_defender_is_not_taught_as_a_problem() -> None:
    board = chess.Board()
    for san in ("e4", "e5", "Qh5", "Nc6"):
        board.push_san(san)
    facts = move_fundamentals(board, chess.Move.from_uci("f1c4"))
    assert not any("last geometric defender" in fact.statement for fact in facts)


def test_geometric_defender_does_not_imply_a_legal_recapture() -> None:
    board = chess.Board("4r1k1/8/6b1/8/8/3QR3/8/4K3 b - - 0 1")
    assert board.is_valid()
    assert board.is_pinned(chess.WHITE, chess.E3)
    facts = capture_facts(board)
    capture = next(fact for fact in facts if "Bxd3" in fact.statement)
    assert "no immediate legal recapture" in capture.statement
    assert "undefended" not in capture.statement
    assert any("rook on e3 is pinned" in fact.statement for fact in position_facts(board))


def test_recapturable_piece_is_not_called_free() -> None:
    board = chess.Board("r5k1/8/8/8/8/8/PR6/6K1 b - - 0 1")
    assert board.is_valid()
    assert not capture_facts(board)


def test_en_passant_uses_the_captured_pawns_actual_square() -> None:
    board = chess.Board("6k1/8/8/3pP3/8/8/8/6K1 w - d6 0 2")
    move = chess.Move.from_uci("e5d6")
    assert any(
        "Black's pawn on d5 en passant" in fact.statement for fact in move_fundamentals(board, move)
    )
    assert "Black's pawn on d5" in capture_facts(board)[0].statement
    assert "recapture on d6" in capture_facts(board)[0].statement


def test_promotion_facts_name_the_promoted_piece() -> None:
    board = chess.Board("7k/P7/8/8/4P3/8/8/7K w - - 0 1")
    facts = move_fundamentals(board, chess.Move.from_uci("a7a8q"))
    assert any("White's queen on a8 as a defender" in fact.statement for fact in facts)
    assert not any("White's pawn on a8" in fact.statement for fact in facts)


def test_castling_is_not_a_guarantee_of_king_safety() -> None:
    board = chess.Board("4k3/8/8/8/8/8/8/4K2R w K - 0 1")
    facts = move_fundamentals(board, chess.Move.from_uci("e1g1"))
    castle = next(fact for fact in facts if "castles" in fact.statement)
    assert "does not guarantee" in castle.lesson


def test_evidence_generation_never_mutates_the_board_or_history() -> None:
    board = chess.Board()
    board.push_san("e4")
    board.push_san("e5")
    before = board.fen(), list(board.move_stack)
    move_fundamentals(board, chess.Move.from_uci("b1c3"))
    capture_facts(board)
    position_facts(board)
    line = line_fact(board, ["g1f3", "b8c6", "f1b5"])
    assert "2.Nf3 2...Nc6 3.Bb5" in line
    assert (board.fen(), board.move_stack) == before


@pytest.mark.parametrize("uci", ["e2e5", "e7e5", "0000"])
def test_illegal_moves_cannot_become_teaching_evidence(uci: str) -> None:
    with pytest.raises(ValueError):
        move_fundamentals(chess.Board(), chess.Move.from_uci(uci))
    with pytest.raises(ValueError):
        line_fact(chess.Board(), [uci])


def test_a_narrative_cannot_change_the_piece_on_a_known_square() -> None:
    board = chess.Board()
    board.push_san("e4")
    facts = [Evidence("White's pawn on e4 occupies the center.", 1, lesson="Support the center.")]
    draft = CoachingDraft.model_validate(
        {
            "explanation": [
                {"text": "White's queen on e4 controls the center.", "evidence_ids": [1]}
            ],
            "takeaway": {"text": "Support the center.", "evidence_ids": [1]},
        }
    )
    with pytest.raises(ValueError, match="piece placement"):
        validate_explanation(draft, facts, [board])


def test_every_paragraph_must_cite_its_own_move_evidence() -> None:
    facts = [
        Evidence("White is to move.", 0),
        Evidence("1.Nc3 develops White's knight.", 0, lesson="Develop minor pieces."),
    ]
    draft = CoachingDraft.model_validate(
        {
            "explanation": [{"text": "Nc3 develops a piece.", "evidence_ids": [1]}],
            "takeaway": {"text": "Develop minor pieces.", "evidence_ids": [2]},
        }
    )
    with pytest.raises(ValueError, match="unsupported moves"):
        validate_explanation(draft, facts, [chess.Board()])


class TeachingEngine(Engine):
    async def evaluate(self, board: chess.Board) -> Evaluation:
        uci = "b1c3" if board.turn else "f6e4"
        move = chess.Move.from_uci(uci)
        assert move in board.legal_moves
        score = Score(kind="cp", value=0 if board.turn else -200)
        return Evaluation(
            score,
            12,
            [AnalysisLine(uci=[uci], san=[board.san(move)], score=score)],
            uci,
        )


@pytest.mark.parametrize(
    ("question", "detail"),
    [
        ("Why was the last move bad?", "last geometric defender"),
        ("Why is the alternative better?", "as a defender of White's pawn on e4"),
    ],
)
async def test_coach_teaches_the_cause_not_just_the_evaluation(
    settings: Settings, question: str, detail: str
) -> None:
    settings.engine_mode = "stockfish"
    settings.stockfish_path = "unused-by-test-engine"
    store = GameStore(settings)
    game = store.import_pgn(f'[SetUp "1"]\n[FEN "{LOOSE_PAWN_FEN}"]\n\n10. Qf1 *')
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(500))
    ) as client:
        engine = TeachingEngine(settings)
        coach = Coach(settings, store, Analyzer(settings, store, engine), client)
        result = await coach.respond(CoachRequest(game_id=game.id, ply=1, question=question))
    assert detail in result.message
    assert "blunder" in result.message
    assert "Takeaway:" in result.message
    assert len(result.message) <= 2000
    assert result.citations == [
        f"{game.id}:1:{game.positions[1].position_key}",
        f"{game.id}:0:{game.positions[0].position_key}",
    ]
    assert result.suggested_moves[0].uci == "f6e4"
    assert result.suggested_moves[0].engine_verified
    assert "b1c3" not in [move.uci for move in result.suggested_moves]
