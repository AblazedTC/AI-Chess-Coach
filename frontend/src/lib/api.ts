import type {
  AnalysisJob,
  ChatMessage,
  CoachResponse,
  GameDetail,
  GameSummary,
  Health,
  Insights,
  Player,
  PositionAnalysis,
  Practice,
} from "./types";

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000").replace(
  /\/$/,
  "",
);

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function request<T>(
  path: string,
  options: { signal?: AbortSignal; method?: string; body?: unknown } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method || "GET",
      signal: options.signal,
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error(
      "Cannot reach the chess service. Check that the backend is running, then retry.",
    );
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = data as {
      error?: { message?: string; code?: string };
      request_id?: string;
    } | null;
    throw new ApiError(
      failure?.error?.message || `The request could not be completed (${response.status}).`,
      response.status,
      failure?.error?.code || "request_failed",
      failure?.request_id,
    );
  }
  if (data === null) throw new Error("The chess service returned an empty response. Please retry.");
  return data as T;
}

const post = <T>(path: string, body: unknown, signal?: AbortSignal) =>
  request<T>(path, { method: "POST", body, signal });

export const api = {
  health: (signal?: AbortSignal) => request<Health>("/api/health", { signal }),
  demo: (signal?: AbortSignal) => request<GameDetail>("/api/demo", { signal }),
  player: (username: string, signal?: AbortSignal) =>
    request<Player>(`/api/players/${encodeURIComponent(username)}`, { signal }),
  games: (username: string, signal?: AbortSignal) =>
    request<{ games: GameSummary[] }>(`/api/players/${encodeURIComponent(username)}/games`, {
      signal,
    }),
  game: (id: string, signal?: AbortSignal) =>
    request<GameDetail>(`/api/games/${encodeURIComponent(id)}`, { signal }),
  import: (pgn: string, signal?: AbortSignal) =>
    post<GameDetail>("/api/games/import", { pgn }, signal),
  position: (game_id: string, ply: number, signal?: AbortSignal) =>
    post<PositionAnalysis>("/api/analysis/position", { game_id, ply }, signal),
  startJob: (game_id: string, signal?: AbortSignal) =>
    post<AnalysisJob>("/api/analysis/jobs", { game_id }, signal),
  job: (id: string, signal?: AbortSignal) =>
    request<AnalysisJob>(`/api/analysis/jobs/${encodeURIComponent(id)}`, { signal }),
  cancelJob: (id: string, signal?: AbortSignal) =>
    request<AnalysisJob>(`/api/analysis/jobs/${encodeURIComponent(id)}`, {
      method: "DELETE",
      signal,
    }),
  coach: (
    game_id: string,
    ply: number,
    question: string,
    history: ChatMessage[],
    signal?: AbortSignal,
  ) => post<CoachResponse>("/api/coach", { game_id, ply, question, history }, signal),
  practice: (game_id: string, ply: number, moves: string[], signal?: AbortSignal) =>
    post<Practice>("/api/practice", { game_id, ply, moves }, signal),
  insights: (game_ids: string[], signal?: AbortSignal) =>
    post<Insights>("/api/insights", { game_ids }, signal),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please retry.";
}
