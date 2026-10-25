export interface Health {
  status: "ok";
  engine_mode: "demo" | "stockfish";
  coach_mode: "deterministic" | "anthropic";
}

export interface Player {
  username: string;
  name: string | null;
  rating: number | null;
  avatar: string | null;
}

export interface GameSummary {
  id: string;
  white: string;
  black: string;
  result: string;
  end_time: number | null;
  time_control: string | null;
  url: string | null;
}

export interface Position {
  ply: number;
  fen: string;
  position_key: string;
  turn: "white" | "black";
  in_check: boolean;
}

export interface Move {
  ply: number;
  san: string;
  uci: string;
  from_square: string;
  to_square: string;
}

export interface GameDetail {
  id: string;
  white: string;
  black: string;
  result: string;
  headers: Record<string, string>;
  positions: Position[];
  moves: Move[];
  pgn: string;
}

export interface Score {
  kind: "cp" | "mate";
  value: number;
}

export interface PositionAnalysis {
  game_id: string;
  ply: number;
  position_key: string;
  source: "stockfish" | "demo";
  score: Score;
  depth: number | null;
  lines: { uci: string[]; san: string[]; score: Score }[];
  best_move: string | null;
  classification: string | null;
  loss_cp: number | null;
}

export interface AnalysisJob {
  id: string;
  game_id: string;
  status: "queued" | "running" | "completed" | "cancelled" | "failed";
  completed: number;
  total: number;
  analyses: PositionAnalysis[];
  error: string | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CoachResponse {
  game_id: string;
  ply: number;
  position_key: string;
  mode: "deterministic" | "anthropic";
  message: string;
  citations: string[];
  suggested_moves: { san: string; uci: string; engine_verified: boolean }[];
  warning: string | null;
}

export interface Practice {
  fen: string;
  position_key: string;
  moves: string[];
  legal_moves: string[];
  is_game_over: boolean;
}

export interface Citation {
  game_id: string;
  ply: number;
  position_key: string;
}

export interface Insights {
  games_analyzed: number;
  summary: string;
  themes: {
    name: string;
    description: string;
    count: number;
    supporting_positions: Citation[];
  }[];
  limitations: string[];
}
