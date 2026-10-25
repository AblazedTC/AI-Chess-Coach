"use client";

import { useState } from "react";
import { boardSquares } from "@/lib/chess";
import { ChessPiece } from "./chess-piece";

interface BoardProps {
  fen: string;
  flipped?: boolean;
  label?: string;
  lastMove?: { from_square: string; to_square: string };
  legalMoves?: string[];
  onMove?: (move: string) => void;
  disabled?: boolean;
}

export function Board({
  fen,
  flipped = false,
  label = "Chess board",
  lastMove,
  legalMoves,
  onMove,
  disabled,
}: BoardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const squares = boardSquares(fen, flipped);
  const targets = legalMoves
    ?.filter((move) => move.startsWith(selected || "!"))
    .map((move) => move.slice(2, 4));

  function select(square: string) {
    if (!onMove || disabled) return;
    if (selected && targets?.includes(square)) {
      const candidates =
        legalMoves?.filter((move) => move.startsWith(`${selected}${square}`)) || [];
      const move = candidates.find((candidate) => candidate.endsWith("q")) || candidates[0];
      if (move) onMove(move);
      setSelected(null);
    } else {
      setSelected(
        selected !== square && legalMoves?.some((move) => move.startsWith(square)) ? square : null,
      );
    }
  }

  return (
    <div
      className={`chess-board ${onMove ? "interactive-board" : ""}`}
      role="group"
      aria-label={label}
      data-fen={fen}
      aria-describedby={onMove ? "practice-board-help" : undefined}
    >
      {squares.map((item, index) => {
        const classes = [
          "square",
          item.light ? "square-light" : "square-dark",
          lastMove?.from_square === item.square || lastMove?.to_square === item.square
            ? "last-move"
            : "",
          selected === item.square ? "selected-square" : "",
          targets?.includes(item.square) ? "legal-target" : "",
        ].join(" ");
        const coordinates = (
          <>
            {index % 8 === 0 && (
              <span className="rank-label" aria-hidden="true">
                {item.square[1]}
              </span>
            )}
            {index >= 56 && (
              <span className="file-label" aria-hidden="true">
                {item.square[0]}
              </span>
            )}
          </>
        );
        const piece = item.piece ? <ChessPiece piece={item.piece} square={item.square} /> : null;
        return onMove ? (
          <div key={item.square} className={classes}>
            {coordinates}
            <button
              type="button"
              className="square-button"
              aria-label={`${item.square}, ${item.name}`}
              aria-pressed={selected === item.square}
              disabled={disabled}
              onClick={() => select(item.square)}
            >
              {piece}
            </button>
          </div>
        ) : (
          <div
            key={item.square}
            className={classes}
            role="img"
            aria-label={`${item.square}, ${item.name}`}
          >
            {coordinates}
            {piece}
          </div>
        );
      })}
    </div>
  );
}
