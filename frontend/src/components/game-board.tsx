"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import type { WorkspaceModel } from "@/hooks/use-workspace";
import { formatScore, moveRows, scoreHeight } from "@/lib/chess";
import { Board } from "./board";
import { ChessPiece } from "./chess-piece";
import { Tag } from "./ui";

export function GameBoard({
  model,
}: {
  model: Pick<WorkspaceModel, "state" | "position" | "navigate" | "flip"> & {
    analysis?: WorkspaceModel["analysis"];
  };
}) {
  const { state, position } = model;
  if (!state.game || !position) return null;
  const game = state.game;
  const last = game.positions.at(-1)?.ply ?? 0;
  const currentMove = game.moves.find((move) => move.ply === state.ply);
  const topName = state.flipped ? game.white : game.black;
  const bottomName = state.flipped ? game.black : game.white;
  const height = model.analysis ? scoreHeight(model.analysis, position.turn) : null;
  const fillStyle: CSSProperties & { "--white-share": string } = {
    "--white-share": `${100 - (height ?? 50)}%`,
  };
  const source = model.analysis?.source === "demo" ? "Material balance" : "Evaluation";
  const score = model.analysis ? formatScore(model.analysis.score) : "—";

  return (
    <section className="board-panel" aria-label="Game replay">
      <div className="player-bar">
        <div className="player-avatar" aria-hidden="true">
          <ChessPiece piece={state.flipped ? "K" : "k"} />
        </div>
        <div>
          <strong>{topName}</strong>
          <small>{state.flipped ? "White pieces" : "Black pieces"}</small>
        </div>
        <Tag>{game.headers.TimeControl || "Game review"}</Tag>
      </div>
      <div className="board-frame">
        <div
          className={`evaluation-bar ${state.flipped ? "is-flipped" : ""}`}
          role="img"
          aria-label={
            model.analysis ? `${source}: ${score}, White's perspective` : "Position not analyzed"
          }
          title={model.analysis ? `${source}: ${score}, White's perspective` : "Not analyzed"}
        >
          <div className="evaluation-fill" style={fillStyle} />
          <span>{score}</span>
        </div>
        <Board fen={position.fen} flipped={state.flipped} lastMove={currentMove} />
      </div>
      <div className="player-bar bottom-player">
        <div className="player-avatar" aria-hidden="true">
          <ChessPiece piece={state.flipped ? "k" : "K"} />
        </div>
        <div>
          <strong>{bottomName}</strong>
          <small>{state.flipped ? "Black pieces" : "White pieces"}</small>
        </div>
        <span className="turn-indicator">
          <span className={`player-dot ${position.turn}`} />
          {position.turn} to move{position.in_check ? " · in check" : ""}
        </span>
      </div>
      <div className="replay-controls">
        <span className="position-label">
          <span aria-live="polite">Position {state.ply}</span>
          <small> / {last}</small>
        </span>
        <div className="move-controls">
          <button
            className="icon-button"
            data-move-navigation
            aria-label="First position"
            title="First position (Home)"
            disabled={state.ply === 0}
            onClick={() => model.navigate(0)}
          >
            ⇤
          </button>
          <button
            className="icon-button"
            data-move-navigation
            aria-label="Previous move"
            title="Previous move (←)"
            disabled={state.ply === 0}
            onClick={() => model.navigate(state.ply - 1)}
          >
            ‹
          </button>
          <button
            className="icon-button"
            data-move-navigation
            aria-label="Next move"
            title="Next move (→)"
            disabled={state.ply === last}
            onClick={() => model.navigate(state.ply + 1)}
          >
            ›
          </button>
          <button
            className="icon-button"
            data-move-navigation
            aria-label="Last position"
            title="Last position (End)"
            disabled={state.ply === last}
            onClick={() => model.navigate(last)}
          >
            ⇥
          </button>
        </div>
        <button
          className="icon-button flip-button"
          aria-label="Flip board"
          title="Flip board (F)"
          onClick={model.flip}
        >
          ⇅
        </button>
      </div>
    </section>
  );
}

export function MoveList({
  model,
  active = true,
}: {
  model: Pick<WorkspaceModel, "state" | "navigate">;
  active?: boolean;
}) {
  const { state } = model;
  const selectedMove = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (active) selectedMove.current?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
  }, [state.ply, active]);
  if (!state.game) return null;
  const rows = moveRows(state.game.moves, state.game.positions[0].fen);
  return (
    <section className="moves-panel" aria-label="Game moves">
      <div className="moves-header">
        <h2>Moves</h2>
        <small>← → navigate · F flip</small>
      </div>
      <div className="move-list" aria-label="Move list">
        {rows.length === 0 && <p className="muted">Starting position. No moves yet.</p>}
        {rows.map((row) => (
          <div
            className="move-row"
            key={row.fullmove}
            role="group"
            aria-label={`Move ${row.fullmove}`}
          >
            <span className="move-number">{row.fullmove}.</span>
            {[row.white, row.black].map((move, index) =>
              move ? (
                <button
                  key={move.ply}
                  className={move.ply === state.ply ? "current-move" : ""}
                  ref={move.ply === state.ply ? selectedMove : null}
                  aria-label={`Go to move ${move.ply}: ${move.san}`}
                  aria-current={move.ply === state.ply ? "step" : undefined}
                  onClick={() => model.navigate(move.ply)}
                >
                  {move.san}
                </button>
              ) : (
                <span
                  key={`empty-${index}`}
                  className="empty-move"
                  aria-label={`No ${index === 0 ? "White" : "Black"} move`}
                >
                  —
                </span>
              ),
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
