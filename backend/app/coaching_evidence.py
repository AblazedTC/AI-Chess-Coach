from dataclasses import dataclass

import chess

CENTRAL_SQUARES = chess.SquareSet([chess.D4, chess.E4, chess.D5, chess.E5])


@dataclass(frozen=True)
class BoardFact:
    statement: str
    lesson: str


def piece_label(piece: chess.Piece) -> str:
    return f"{'White' if piece.color else 'Black'}'s {chess.piece_name(piece.piece_type)}"


def move_label(board: chess.Board, move: chess.Move) -> str:
    separator = "." if board.turn == chess.WHITE else "..."
    return f"{board.fullmove_number}{separator}{board.san(move)}"


def captured_square(board: chess.Board, move: chess.Move) -> chess.Square:
    if board.is_en_passant(move):
        return chess.square(chess.square_file(move.to_square), chess.square_rank(move.from_square))
    return move.to_square


def capture_facts(board: chess.Board) -> list[BoardFact]:
    facts: list[BoardFact] = []
    captures = sorted(
        board.generate_legal_captures(),
        key=lambda move: (
            -(board.piece_type_at(captured_square(board, move)) or 0),
            move.uci(),
        ),
    )
    seen: set[chess.Square] = set()
    for move in captures:
        square = captured_square(board, move)
        victim = board.piece_at(square)
        if victim is None or square in seen:
            continue
        reply = board.copy(stack=False)
        reply.push(move)
        if any(
            candidate.to_square == move.to_square for candidate in reply.generate_legal_captures()
        ):
            continue
        seen.add(square)
        undefended = " (undefended)" if not board.attackers(victim.color, square) else ""
        side = "White" if board.turn else "Black"
        attacker = board.piece_at(move.from_square)
        assert attacker is not None
        facts.append(
            BoardFact(
                f"{side} can play {move_label(board, move)} with the "
                f"{chess.piece_name(attacker.piece_type)} from "
                f"{chess.square_name(move.from_square)}, legally capturing "
                f"{piece_label(victim)} on {chess.square_name(square)}{undefended}. "
                f"There is no immediate legal recapture on "
                f"{chess.square_name(move.to_square)}; this alone does not prove "
                "that the capture is good or that a sacrifice is unsound.",
                "Before choosing a move, check the opponent's legal captures and whether a "
                "captured piece can actually be recaptured.",
            )
        )
        if len(facts) == 2:
            break
    return facts


def position_facts(board: chess.Board) -> list[BoardFact]:
    if board.is_game_over():
        return []
    facts = capture_facts(board)
    side = "White" if board.turn else "Black"
    home_rank = 0 if board.turn else 7
    home_pieces = [
        chess.square_name(square)
        for square, piece_type in (
            (chess.square(1, home_rank), chess.KNIGHT),
            (chess.square(2, home_rank), chess.BISHOP),
            (chess.square(5, home_rank), chess.BISHOP),
            (chess.square(6, home_rank), chess.KNIGHT),
        )
        if board.piece_at(square) == chess.Piece(piece_type, board.turn)
    ]
    if home_pieces and board.fullmove_number <= 12:
        facts.append(
            BoardFact(
                f"{side} still has minor pieces on these starting squares: "
                f"{', '.join(home_pieces)}.",
                "Bring minor pieces into play and contest the center before spending extra "
                "moves on pieces that are already active.",
            )
        )
    for square, piece in sorted(board.piece_map().items()):
        if piece.piece_type != chess.KING and board.is_pinned(piece.color, square):
            facts.append(
                BoardFact(
                    f"{piece_label(piece)} on {chess.square_name(square)} is pinned to its king.",
                    "A pinned piece may be unable to defend another piece legally; check "
                    "legal recaptures rather than just counting defenders.",
                )
            )
            if len(facts) >= 5:
                break
    return facts


def move_fundamentals(board: chess.Board, move: chess.Move) -> list[BoardFact]:
    if move not in board.legal_moves:
        raise ValueError("Coaching evidence requires a legal move.")
    piece = board.piece_at(move.from_square)
    assert piece is not None
    after = board.copy(stack=False)
    after.push(move)
    active_piece = after.piece_at(move.to_square)
    assert active_piece is not None
    label = move_label(board, move)
    origin = chess.square_name(move.from_square)
    destination = chess.square_name(move.to_square)
    before_attacks = board.attacks(move.from_square)
    after_attacks = after.attacks(move.to_square)
    facts: list[BoardFact] = []
    if board.is_capture(move):
        square = captured_square(board, move)
        victim = board.piece_at(square)
        assert victim is not None
        facts.append(
            BoardFact(
                f"{label} captures {piece_label(victim)} on {chess.square_name(square)}"
                + (" en passant." if board.is_en_passant(move) else "."),
                "A capture changes material, but check the opponent's reply before assuming "
                "that winning a piece is safe.",
            )
        )
    for square in CENTRAL_SQUARES:
        pawn = after.piece_at(square)
        if (
            pawn == chess.Piece(chess.PAWN, piece.color)
            and square in after_attacks
            and square not in before_attacks
        ):
            facts.append(
                BoardFact(
                    f"{label} adds {piece_label(active_piece)} on {destination} as a defender of "
                    f"{piece_label(pawn)} on {chess.square_name(square)}, a central pawn.",
                    "Developing with a purpose can improve a piece while also protecting "
                    "a central pawn.",
                )
            )
    for square, victim in sorted(after.piece_map().items()):
        if (
            victim.color == piece.color
            and victim.piece_type != chess.KING
            and square != move.to_square
            and square in before_attacks
            and not after.attackers(piece.color, square)
            and any(
                captured_square(after, candidate) == square
                for candidate in after.generate_legal_captures()
            )
        ):
            facts.append(
                BoardFact(
                    f"{label} removes the last geometric defender of {piece_label(victim)} "
                    f"on {chess.square_name(square)}. Whether this loses material depends "
                    "on the opponent's legal replies.",
                    "Before moving a defender, check which pieces or pawns it leaves behind.",
                )
            )
            break
    if board.is_castling(move):
        facts.append(
            BoardFact(
                f"{label} castles: the king leaves {origin} for {destination} and the rook "
                "moves toward the center.",
                "Castling connects king safety with rook activity, but does not guarantee "
                "that the king is safe from every attack.",
            )
        )
    if (
        piece.piece_type in (chess.KNIGHT, chess.BISHOP)
        and chess.square_rank(move.from_square) == (0 if piece.color else 7)
        and chess.square_rank(move.to_square) != chess.square_rank(move.from_square)
        and board.fullmove_number <= 12
    ):
        facts.append(
            BoardFact(
                f"{label} brings {piece_label(piece)} off the back rank, from {origin} "
                f"to {destination}.",
                "Develop minor pieces onto useful squares instead of leaving them on "
                "the back rank.",
            )
        )
    gained_center = CENTRAL_SQUARES & (after_attacks - before_attacks)
    if gained_center:
        facts.append(
            BoardFact(
                f"{label} adds attacks on these central squares: "
                f"{', '.join(chess.square_name(square) for square in gained_center)}.",
                "Central control gives pieces useful influence; combine it with "
                "piece safety rather than treating it as an automatic reason a move is best.",
            )
        )
    if piece.piece_type == chess.PAWN and move.to_square in CENTRAL_SQUARES:
        facts.append(
            BoardFact(
                f"{label} places {piece_label(piece)} on the central square {destination}.",
                "A central pawn claims space, but it still needs support against pressure.",
            )
        )
    if after.is_check():
        facts.append(
            BoardFact(
                f"{label} gives check; the opponent's next legal move must answer it.",
                "Look at forcing moves, but follow a check with the opponent's best legal reply.",
            )
        )
    return facts[:7]


def line_fact(board: chess.Board, moves: list[str]) -> str:
    replay = board.copy(stack=False)
    labels: list[str] = []
    captures: list[str] = []
    for uci in moves[:4]:
        move = chess.Move.from_uci(uci)
        if move not in replay.legal_moves:
            raise ValueError("Coaching engine line contains an illegal move.")
        labels.append(move_label(replay, move))
        if replay.is_capture(move):
            square = captured_square(replay, move)
            victim = replay.piece_at(square)
            assert victim is not None
            captures.append(
                f"{move_label(replay, move)} captures {piece_label(victim)} on "
                f"{chess.square_name(square)}"
            )
        replay.push(move)
    return " ".join(labels) + ("; " + "; ".join(captures) if captures else "") + "."
