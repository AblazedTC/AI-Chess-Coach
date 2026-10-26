"use client";

import { useState } from "react";
import type { WorkspaceModel } from "@/hooks/use-workspace";
import { MAX_COACH_CONTENT } from "@/lib/limits";
import { ErrorNotice, Spinner, Tag } from "./ui";

function citationPly(citation: string, fallback: number) {
  const match = /^[^:]+:(\d+):[^:]+$/.exec(citation);
  const ply = match ? Number(match[1]) : NaN;
  return Number.isInteger(ply) && ply >= 0 && ply <= 500 ? ply : fallback;
}

export function CoachPanel({ model }: { model: WorkspaceModel }) {
  const [question, setQuestion] = useState("");
  const [questionKey, setQuestionKey] = useState("");
  const contextKey = `${model.state.game?.id}:${model.state.ply}`;
  const value = questionKey === contextKey ? question : "";
  const conversation = model.conversation;
  const response = conversation?.response;
  const mode = response?.mode || model.health?.coach_mode;
  const questions = [
    model.state.ply > 0
      ? "Why did the last move matter?"
      : "How should I develop and defend the center?",
    model.state.ply > 0
      ? "Why is the engine's alternative better?"
      : "What is the idea behind the engine's suggested move?",
    "What practical lesson and plan should I take from this position?",
  ];
  function update(value: string) {
    setQuestionKey(contextKey);
    setQuestion(value);
  }

  return (
    <section className="panel coach-panel" aria-label="Chess coach">
      <div className="coach-heading">
        <span className="coach-avatar" aria-hidden="true">
          ✧
        </span>
        <div>
          <h2>Your coach</h2>
          <p>Let&apos;s understand the why.</p>
        </div>
        <Tag tone="green">
          {!mode
            ? "Coach status pending"
            : mode === "anthropic"
              ? "AI + evidence"
              : "Offline coach"}
        </Tag>
      </div>
      <div className="coach-context">
        <span className="tiny-dot" /> Studying position {model.state.ply}
        <span>{model.position?.turn} to move</span>
      </div>
      <div className="coach-scroll">
        {response?.warning && <p className="honesty-note">{response.warning}</p>}
        <div
          className="coach-response"
          role="region"
          aria-label="Coach response"
          aria-live="polite"
          aria-busy={model.coachBusy}
        >
          {conversation?.messages.length ? (
            <div className="chat-history">
              {conversation.messages.map((message, index) => (
                <div className={`chat-message ${message.role}`} key={index}>
                  <small>{message.role === "user" ? "You" : "Coach"}</small>
                  <p>{message.content}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="coach-empty">
              <p>A good question is the first move.</p>
              <span>
                Ask about this exact position. Your conversation stays with it as you explore the
                game.
              </span>
            </div>
          )}
          {model.coachBusy && <Spinner label="Looking at the position" />}
        </div>
        {response && (
          <details className="coach-evidence">
            <summary className="evidence-heading">
              <span>Position evidence</span>
              <Tag>{response.mode === "deterministic" ? "Deterministic" : "Anthropic"}</Tag>
            </summary>
            {response.citations.length > 0 && (
              <ul className="citation-list">
                {response.citations.map((citation, index) => {
                  const ply = citationPly(citation, response.ply);
                  return (
                    <li key={index}>
                      <button
                        className="citation-button"
                        onClick={() => model.navigate(ply)}
                        title={citation}
                      >
                        <span aria-hidden="true">⌖</span> Position {ply}
                        <small>{citation}</small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {response.suggested_moves.map((move) => (
              <p className="suggested-move" key={move.uci}>
                <strong>{move.san}</strong> <code>{move.uci}</code>
                <small>{move.engine_verified ? "Engine verified" : "Not engine verified"}</small>
              </p>
            ))}
          </details>
        )}
        {model.coachError && <ErrorNotice>{model.coachError}</ErrorNotice>}
        <div className="question-suggestions">
          {questions.map((suggestion) => (
            <button key={suggestion} onClick={() => update(suggestion)} disabled={model.coachBusy}>
              {suggestion}
            </button>
          ))}
        </div>
      </div>
      <form
        className="coach-form"
        onSubmit={async (event) => {
          event.preventDefault();
          await model.askCoach(value);
        }}
      >
        <label htmlFor="question">Ask a question</label>
        <textarea
          id="question"
          rows={2}
          value={value}
          onChange={(event) => update(event.target.value)}
          placeholder="What can I learn from this position?"
          maxLength={MAX_COACH_CONTENT}
          aria-describedby="question-limit"
          required
        />
        <p id="question-limit" className="field-hint">
          {value.length} / {MAX_COACH_CONTENT.toLocaleString()} characters
        </p>
        <div className="coach-form-footer">
          <small>
            {mode === "anthropic"
              ? "Grounded in position evidence. Can still be wrong."
              : "Deterministic guidance. No API key required."}
          </small>
          <button
            className="button primary small"
            disabled={model.coachBusy || !value.trim()}
            aria-label="Ask coach"
          >
            {model.coachBusy ? (
              "Thinking…"
            ) : (
              <>
                Ask coach <span aria-hidden="true">↑</span>
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
