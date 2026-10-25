from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

GameId = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{24}$")]
Ply = Annotated[int, Field(ge=0, le=500, strict=True)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ErrorDetail(Model):
    code: str
    message: str


class ErrorResponse(Model):
    error: ErrorDetail
    request_id: str


class Health(Model):
    status: Literal["ok"] = "ok"
    engine_mode: Literal["demo", "stockfish"]
    coach_mode: Literal["deterministic", "anthropic"]


class Player(Model):
    username: str
    name: str | None = None
    rating: int | None = None
    avatar: str | None = None


class GameSummary(Model):
    id: str
    white: str
    black: str
    result: str
    end_time: int | None = None
    time_control: str | None = None
    url: str | None = None


class GameList(Model):
    games: list[GameSummary]


class Position(Model):
    ply: int
    fen: str
    position_key: str
    turn: Literal["white", "black"]
    in_check: bool


class Move(Model):
    ply: int
    san: str
    uci: str
    from_square: str
    to_square: str


class GameDetail(Model):
    id: str
    white: str
    black: str
    result: str
    headers: dict[str, str]
    positions: list[Position]
    moves: list[Move]
    pgn: str


class ImportRequest(Model):
    pgn: str = Field(min_length=1, max_length=250_000)


class PositionRequest(Model):
    game_id: GameId
    ply: Ply


class Score(Model):
    kind: Literal["cp", "mate"]
    value: int


class AnalysisLine(Model):
    uci: list[str]
    san: list[str]
    score: Score


class PositionAnalysis(Model):
    game_id: str
    ply: int
    position_key: str
    source: Literal["stockfish", "demo"]
    score: Score
    depth: int | None
    lines: list[AnalysisLine]
    best_move: str | None
    classification: Literal["best", "good", "inaccuracy", "mistake", "blunder"] | None
    loss_cp: int | None


class JobRequest(Model):
    game_id: GameId


class AnalysisJob(Model):
    id: str
    game_id: str
    status: Literal["queued", "running", "completed", "cancelled", "failed"]
    completed: int
    total: int
    analyses: list[PositionAnalysis]
    error: str | None = None


class HistoryMessage(Model):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)


class CoachRequest(PositionRequest):
    question: str = Field(min_length=1, max_length=2000)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=12)


class SuggestedMove(Model):
    san: str
    uci: str
    engine_verified: bool


class CoachResponse(Model):
    game_id: str
    ply: int
    position_key: str
    mode: Literal["deterministic", "anthropic"]
    message: str
    citations: list[str]
    suggested_moves: list[SuggestedMove]
    warning: str | None


class PracticeRequest(PositionRequest):
    moves: list[Annotated[str, StringConstraints(min_length=4, max_length=5)]] = Field(
        default_factory=list, max_length=100
    )


class PracticeResponse(Model):
    fen: str
    position_key: str
    moves: list[str]
    legal_moves: list[str]
    is_game_over: bool


class InsightRequest(Model):
    game_ids: list[GameId] = Field(min_length=1, max_length=10)


class SupportingPosition(Model):
    game_id: str
    ply: int
    position_key: str


class Theme(Model):
    name: str
    description: str
    count: int
    supporting_positions: list[SupportingPosition]


class Insights(Model):
    games_analyzed: int
    summary: str
    themes: list[Theme]
    limitations: list[str]
