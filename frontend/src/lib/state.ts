import type {
  AnalysisJob,
  ChatMessage,
  CoachResponse,
  GameDetail,
  PositionAnalysis,
  Practice,
} from "./types";

export interface Conversation {
  messages: ChatMessage[];
  response: CoachResponse | null;
}

export interface WorkspaceState {
  game: GameDetail | null;
  ply: number;
  flipped: boolean;
  analyses: Record<number, PositionAnalysis>;
  conversations: Record<number, Conversation>;
  practice: Practice | null;
  practiceOpen: boolean;
  job: AnalysisJob | null;
}

export const initialState: WorkspaceState = {
  game: null,
  ply: 0,
  flipped: false,
  analyses: {},
  conversations: {},
  practice: null,
  practiceOpen: false,
  job: null,
};

export type Action =
  | { type: "load"; game: GameDetail; ply?: number }
  | { type: "navigate"; ply: number }
  | { type: "flip" }
  | { type: "analysis"; analysis: PositionAnalysis }
  | { type: "coach"; response: CoachResponse; question: string }
  | { type: "practice"; gameId: string; ply: number; practice: Practice }
  | { type: "practice-open"; open: boolean }
  | { type: "job"; job: AnalysisJob };

export function reducer(state: WorkspaceState, action: Action): WorkspaceState {
  switch (action.type) {
    case "load": {
      const position = action.game.positions.find((item) => item.ply === (action.ply ?? 0));
      return {
        ...initialState,
        flipped: state.flipped,
        game: action.game,
        ply: position?.ply ?? action.game.positions[0]?.ply ?? 0,
      };
    }
    case "navigate": {
      if (!state.game) return state;
      const plies = state.game.positions.map((position) => position.ply);
      const ply = Math.max(Math.min(...plies), Math.min(action.ply, Math.max(...plies)));
      if (!plies.includes(ply) || ply === state.ply) return state;
      return { ...state, ply, practice: null };
    }
    case "flip":
      return { ...state, flipped: !state.flipped };
    case "analysis": {
      const position = state.game?.positions.find((item) => item.ply === action.analysis.ply);
      if (
        action.analysis.game_id !== state.game?.id ||
        action.analysis.position_key !== position?.position_key
      ) {
        return state;
      }
      return {
        ...state,
        analyses: { ...state.analyses, [action.analysis.ply]: action.analysis },
      };
    }
    case "coach": {
      const { response } = action;
      const position = state.game?.positions.find((item) => item.ply === response.ply);
      if (
        response.game_id !== state.game?.id ||
        response.ply !== state.ply ||
        response.position_key !== position?.position_key
      )
        return state;
      const previous = state.conversations[response.ply]?.messages || [];
      return {
        ...state,
        conversations: {
          ...state.conversations,
          [response.ply]: {
            messages: [
              ...previous,
              { role: "user", content: action.question },
              { role: "assistant", content: response.message },
            ],
            response,
          },
        },
      };
    }
    case "practice":
      if (action.gameId !== state.game?.id || action.ply !== state.ply) return state;
      return { ...state, practice: action.practice };
    case "practice-open":
      return { ...state, practiceOpen: action.open, practice: null };
    case "job": {
      if (action.job.game_id !== state.game?.id) return state;
      if (state.job && state.job.id !== action.job.id && isRunning(state.job)) return state;
      if (state.job?.id === action.job.id && !isRunning(state.job) && isRunning(action.job))
        return state;
      const analyses = { ...state.analyses };
      for (const analysis of action.job.analyses) {
        const position = state.game.positions.find((item) => item.ply === analysis.ply);
        if (
          analysis.game_id === state.game.id &&
          analysis.position_key === position?.position_key
        ) {
          analyses[analysis.ply] = analysis;
        }
      }
      return { ...state, job: action.job, analyses };
    }
  }
}

function isRunning(job: AnalysisJob) {
  return job.status === "running" || job.status === "queued";
}
