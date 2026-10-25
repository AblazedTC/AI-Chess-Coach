import { START_FEN } from "@/lib/chess";
import type {
  AnalysisJob,
  CoachResponse,
  GameDetail,
  PositionAnalysis,
  Practice,
} from "@/lib/types";

export const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
export const AFTER_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2";

export const game: GameDetail = {
  id: "test-game",
  white: "CuriousPlayer",
  black: "ThoughtfulPlayer",
  result: "*",
  headers: { Event: "Test" },
  positions: [
    { ply: 0, fen: START_FEN, position_key: "test-0", turn: "white", in_check: false },
    { ply: 1, fen: AFTER_E4, position_key: "test-1", turn: "black", in_check: false },
    { ply: 2, fen: AFTER_E5, position_key: "test-2", turn: "white", in_check: false },
  ],
  moves: [
    { ply: 1, san: "e4", uci: "e2e4", from_square: "e2", to_square: "e4" },
    { ply: 2, san: "e5", uci: "e7e5", from_square: "e7", to_square: "e5" },
  ],
  pgn: "1. e4 e5 *",
};

export const analysis: PositionAnalysis = {
  game_id: game.id,
  ply: 0,
  position_key: "test-0",
  source: "demo",
  score: { kind: "cp", value: 0 },
  depth: null,
  lines: [],
  best_move: null,
  classification: null,
  loss_cp: null,
};

export const coach: CoachResponse = {
  game_id: game.id,
  ply: 0,
  position_key: "test-0",
  mode: "deterministic",
  message: "Material is balanced. Develop your pieces with care.",
  citations: ["test-0"],
  suggested_moves: [],
  warning: "Demo coaching is limited to verifiable facts.",
};

export const practice: Practice = {
  fen: START_FEN,
  position_key: "test-0",
  moves: [],
  legal_moves: ["e2e4", "d2d4"],
  is_game_over: false,
};

export const job: AnalysisJob = {
  id: "job-1",
  game_id: game.id,
  status: "running",
  completed: 1,
  total: 3,
  analyses: [analysis],
  error: null,
};

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
