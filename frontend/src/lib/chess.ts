import type { GameDetail, GameSummary, Move, Position, PositionAnalysis, Score } from "./types";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const pieceNames: Record<string, string> = {
  K: "white king",
  Q: "white queen",
  R: "white rook",
  B: "white bishop",
  N: "white knight",
  P: "white pawn",
  k: "black king",
  q: "black queen",
  r: "black rook",
  b: "black bishop",
  n: "black knight",
  p: "black pawn",
};

export interface Square {
  square: string;
  piece: string | null;
  name: string;
  light: boolean;
}

export function boardSquares(fen: string, flipped = false): Square[] {
  const rows = fen.split(" ")[0].split("/");
  const squares: Square[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    let file = 0;
    for (const token of rows[8 - rank] || "") {
      if (/[1-8]/.test(token)) {
        file += Number(token);
      } else {
        const square = `${"abcdefgh"[file]}${rank}`;
        squares.push({
          square,
          piece: token,
          name: pieceNames[token] || "",
          light: (file + rank) % 2 === 0,
        });
        file++;
      }
    }
    for (let index = 0; index < 8; index++) {
      const square = `${"abcdefgh"[index]}${rank}`;
      if (!squares.some((item) => item.square === square)) {
        squares.push({
          square,
          piece: null,
          name: "empty",
          light: (index + rank) % 2 === 0,
        });
      }
    }
  }
  squares.sort(
    (a, b) => Number(b.square[1]) - Number(a.square[1]) || a.square.localeCompare(b.square),
  );
  return flipped ? squares.reverse() : squares;
}

export function formatScore(score: Score): string {
  if (score.kind === "mate") return `M${score.value}`;
  return `${score.value > 0 ? "+" : ""}${(score.value / 100).toFixed(2)}`;
}

export function scoreHeight(analysis: PositionAnalysis, turn?: Position["turn"]): number | null {
  if (analysis.score.kind === "mate" && analysis.score.value === 0) {
    return turn === "white" ? 95 : turn === "black" ? 5 : null;
  }
  const value =
    analysis.score.kind === "mate" ? Math.sign(analysis.score.value) * 1000 : analysis.score.value;
  return Math.max(5, Math.min(95, 50 - value / 20));
}

export function moveRows(moves: Move[], startingFen: string) {
  const fields = startingFen.split(/\s+/);
  let blackToMove = fields[1] === "b";
  let fullmove = Math.max(1, Number.parseInt(fields[5], 10) || 1);
  const rows: { fullmove: number; white: Move | null; black: Move | null }[] = [];
  for (const move of moves) {
    let row = rows.at(-1);
    if (!row || row.fullmove !== fullmove) {
      row = { fullmove, white: null, black: null };
      rows.push(row);
    }
    if (blackToMove) {
      row.black = move;
      fullmove++;
    } else {
      row.white = move;
    }
    blackToMove = !blackToMove;
  }
  return rows;
}

export function summaryOf(game: GameDetail): GameSummary {
  return {
    id: game.id,
    white: game.white,
    black: game.black,
    result: game.result,
    end_time: null,
    time_control: game.headers.TimeControl || null,
    url: null,
  };
}

export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (Boolean(
      target.closest(
        "input, textarea, select, a, [role='dialog'], dialog, [data-shortcuts='ignore']",
      ),
    ) ||
      (Boolean(target.closest("button")) && !target.closest("[data-move-navigation]")) ||
      Boolean(target.isContentEditable))
  );
}

export function isActiveJob(status?: string): boolean {
  return status === "queued" || status === "running";
}
