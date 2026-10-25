"use client";

import { useState } from "react";
import type { WorkspaceModel } from "@/hooks/use-workspace";
import { Board } from "./board";
import { ErrorNotice, SectionHeading, Spinner, Tag } from "./ui";

export function PracticePanel({ model }: { model: WorkspaceModel }) {
  const [move, setMove] = useState("");
  const [moveKey, setMoveKey] = useState("");
  const { state, position } = model;
  const context = `${state.game?.id}:${state.ply}`;
  const value = moveKey === context ? move : "";
  if (!position) return null;
  async function play(value: string) {
    await model.playPractice(value);
    setMove("");
  }

  return (
    <section className="panel practice-panel" aria-label="Practice">
      <SectionHeading eyebrow="Learn by doing" title="Make the next move">
        <button
          className={`button secondary small ${state.practiceOpen ? "is-active" : ""}`}
          onClick={model.openPractice}
          aria-expanded={state.practiceOpen}
          aria-controls="practice-content"
        >
          Practice
        </button>
      </SectionHeading>
      <p className="muted practice-intro">
        Try an idea without changing your game. Every move is checked for legality.
      </p>
      {state.practiceOpen && (
        <div id="practice-content">
          <div className="practice-meta">
            <Tag tone="green">Sandbox · position {state.ply}</Tag>
            <button
              className="text-button"
              onClick={model.resetPractice}
              disabled={model.practiceBusy}
            >
              Reset practice
            </button>
          </div>
          <div className="practice-board-wrap">
            <Board
              key={`${context}:${state.practice?.fen || position.fen}`}
              fen={state.practice?.fen || position.fen}
              flipped={state.flipped}
              label="Practice board"
              legalMoves={state.practice?.legal_moves}
              onMove={(move) => void play(move)}
              disabled={model.practiceBusy || !state.practice || state.practice.is_game_over}
            />
          </div>
          <p className="field-hint" id="practice-board-help">
            Select a piece, then a highlighted square. Promotions default to queen; use the field
            below to underpromote.
          </p>
          {model.practiceBusy && <Spinner label="Checking practice position" />}
          {model.practiceError && (
            <ErrorNotice retry={!state.practice ? model.resetPractice : undefined}>
              {model.practiceError}
            </ErrorNotice>
          )}
          {state.practice?.is_game_over && (
            <p role="status" className="practice-complete">
              This variation is finished. Reset to try another idea.
            </p>
          )}
          <form
            className="practice-form"
            onSubmit={(event) => {
              event.preventDefault();
              void play(value);
            }}
          >
            <div>
              <label htmlFor="practice-move">Practice move</label>
              <input
                id="practice-move"
                value={value}
                placeholder="e2e4"
                autoComplete="off"
                spellCheck={false}
                maxLength={5}
                onChange={(event) => {
                  setMoveKey(context);
                  setMove(event.target.value);
                }}
                required
                aria-describedby="uci-help"
              />
            </div>
            <button
              className="button primary small"
              disabled={
                model.practiceBusy ||
                !state.practice ||
                state.practice.is_game_over ||
                !value.trim()
              }
            >
              Play move
            </button>
          </form>
          <p className="field-hint" id="uci-help">
            UCI notation: from + to, such as e2e4. Promotion: e7e8q.
          </p>
          <div className="practice-line">
            <span>Your line</span>
            <code>{state.practice?.moves.join(" · ") || "No moves played yet"}</code>
          </div>
          <small className="muted">
            {state.practice ? `${state.practice.legal_moves.length} legal moves available. ` : ""}
            Original game unchanged.
          </small>
        </div>
      )}
    </section>
  );
}
