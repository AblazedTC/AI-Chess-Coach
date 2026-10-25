"use client";

import { useState } from "react";
import type { WorkspaceModel } from "@/hooks/use-workspace";
import { ErrorNotice, Spinner } from "./ui";

export function Library({ model, openImport }: { model: WorkspaceModel; openImport: () => void }) {
  const [username, setUsername] = useState("");

  return (
    <aside className="sidebar" aria-label="Game library">
      <a className="brand" href="#main-content" aria-label="Chess Coach workspace">
        <span className="brand-mark" aria-hidden="true">
          ♞
        </span>
        <span>
          chess<span className="brand-light">coach</span>
          <small>YOUR PERSONAL STUDY SPACE</small>
        </span>
      </a>
      <div className="sidebar-section">
        <p className="eyebrow">Your workspace</p>
        <a className="nav-item active" href="#main-content">
          <span aria-hidden="true">▦</span> Game review <span className="nav-dot" />
        </a>
        <a className="nav-item" href="#insights">
          <span aria-hidden="true">↗</span> Insights
        </a>
      </div>
      <section className="sidebar-section" aria-labelledby="library-title">
        <div className="section-heading compact">
          <h2 id="library-title">Game library</h2>
          <span className="count">{model.library.length}</span>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void model.search(username);
          }}
        >
          <label htmlFor="username">Chess.com username</label>
          <div className="search-field">
            <input
              id="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Find your games"
              maxLength={100}
              autoComplete="off"
              required
            />
            <button
              type="submit"
              aria-label="Search games"
              disabled={model.searching || !username.trim()}
            >
              ↗
            </button>
          </div>
        </form>
        {model.searching && <Spinner label="Finding recent games" />}
        {model.searchError && <ErrorNotice>{model.searchError}</ErrorNotice>}
        {model.player && (
          <p className="player-profile">
            {model.player.name || model.player.username}
            {model.player.rating !== null && <span> · {model.player.rating}</span>}
          </p>
        )}
        <button className="button secondary import-button" onClick={openImport}>
          <span aria-hidden="true">＋</span> Import PGN
        </button>
      </section>
      <section className="recent-games sidebar-section" aria-label="Recent games">
        <p className="eyebrow">
          Recent games{" "}
          <span className="muted">{model.library.length ? "· select for insights" : ""}</span>
        </p>
        {!model.library.length && (
          <div className="library-empty">
            <span aria-hidden="true">♙</span>
            <p>
              {model.searched ? "No recent games found." : "Your next lesson is in your last game."}
            </p>
            <small>
              {model.searched
                ? "Try another username or import a PGN."
                : "Search a player, import a PGN, or start with the demo."}
            </small>
          </div>
        )}
        <ul className="game-list">
          {model.library.map((game) => (
            <li
              key={game.id}
              className={`game-card ${model.state.game?.id === game.id ? "current-game" : ""}`}
            >
              <div className="game-card-top">
                <label className="game-select">
                  <input
                    type="checkbox"
                    checked={model.insightIds.includes(game.id)}
                    onChange={() => model.toggleInsightId(game.id)}
                    aria-label={`Include ${game.white} vs ${game.black} in insights`}
                  />
                  <span>{game.time_control || "Imported game"}</span>
                </label>
                <span className="game-result">{game.result}</span>
              </div>
              <p className="game-player">
                <span className="player-dot white" />
                {game.white}
              </p>
              <p className="game-player">
                <span className="player-dot black" />
                {game.black}
              </p>
              <div className="game-card-bottom">
                <small>
                  {game.end_time
                    ? new Date(game.end_time * 1000).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })
                    : "Ready to review"}
                </small>
                <button
                  className="text-button"
                  disabled={model.loading}
                  onClick={() => void model.loadGame(game.id)}
                >
                  Load game <span aria-hidden="true">→</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <div className="sidebar-footer">
        <span className={`connection-dot ${model.healthError ? "offline" : ""}`} />
        <span>
          {model.healthError
            ? "Chess service unavailable"
            : model.health
              ? model.health.engine_mode === "demo"
                ? "Demo mode · no keys needed"
                : "Stockfish connected"
              : "Connecting to chess service"}
        </span>
      </div>
    </aside>
  );
}
