import chess

from app.errors import AppError
from app.games import GameStore, position_key
from app.models import (
    InsightRequest,
    Insights,
    PracticeRequest,
    PracticeResponse,
    SupportingPosition,
    Theme,
)


def practice(games: GameStore, request: PracticeRequest) -> PracticeResponse:
    _, board = games.selected(request.game_id, request.ply)
    for uci in request.moves:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError as exc:
            raise AppError(
                422, "illegal_move", "Practice moves must use legal UCI notation."
            ) from exc
        if move not in board.legal_moves or board.is_game_over():
            raise AppError(422, "illegal_move", "A practice move is illegal in this position.")
        board.push(move)
    return PracticeResponse(
        fen=board.fen(),
        position_key=position_key(board),
        moves=request.moves,
        legal_moves=sorted(move.uci() for move in board.legal_moves)
        if not board.is_game_over()
        else [],
        is_game_over=board.is_game_over(),
    )


def insights(games: GameStore, request: InsightRequest) -> Insights:
    selected = [games.get(game_id) for game_id in dict.fromkeys(request.game_ids)]
    descriptions = {
        "Checking moves": "Moves that put the opponent in check; not necessarily good moves.",
        "Captures": "Moves that capture a piece, including en passant; no quality judgment.",
        "Castling": "Positions immediately after castling.",
        "Promotions": "Positions immediately after pawn promotion.",
    }
    counts = dict.fromkeys(descriptions, 0)
    supports: dict[str, list[SupportingPosition]] = {name: [] for name in descriptions}
    for game in selected:
        board = chess.Board(game.positions[0].fen)
        for move_data in game.moves:
            move = chess.Move.from_uci(move_data.uci)
            matches = {
                "Checking moves": board.gives_check(move),
                "Captures": board.is_capture(move),
                "Castling": board.is_castling(move),
                "Promotions": bool(move.promotion),
            }
            board.push(move)
            for name, matched in matches.items():
                if matched:
                    counts[name] += 1
                    if len(supports[name]) < 30:
                        supports[name].append(
                            SupportingPosition(
                                game_id=game.id,
                                ply=move_data.ply,
                                position_key=game.positions[move_data.ply].position_key,
                            )
                        )
    themes = [
        Theme(
            name=name,
            description=description,
            count=counts[name],
            supporting_positions=supports[name],
        )
        for name, description in descriptions.items()
        if counts[name]
    ]
    return Insights(
        games_analyzed=len(selected),
        summary=f"Observed {len(selected)} unique game(s) with "
        f"{sum(len(game.moves) for game in selected)} played plies. "
        "These are replay facts, not inferred strengths or weaknesses.",
        themes=themes,
        limitations=[
            "Themes are deterministic board events, not engine-verified tactical diagnoses.",
            "No player identity, intent, causal claims or skill estimates are inferred.",
            "Each theme cites at most 30 supporting positions; count includes every occurrence.",
        ],
    )
