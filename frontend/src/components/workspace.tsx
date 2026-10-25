"use client";

import { useState } from "react";
import { useWorkspace } from "@/hooks/use-workspace";
import { CoachPanel } from "./coach-panel";
import { EnginePanel, FullGameAnalysis } from "./analysis-panel";
import { GameBoard } from "./game-board";
import { ImportDialog } from "./import-dialog";
import { InsightsPanel } from "./insights-panel";
import { Library } from "./library";
import { PracticePanel } from "./practice-panel";
import { ErrorNotice, Spinner, Tag } from "./ui";
import { Welcome } from "./welcome";

export function Workspace() {
  const model = useWorkspace();
  const [importOpen, setImportOpen] = useState(false);
  const game = model.state.game;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to workspace
      </a>
      <Library model={model} openImport={() => setImportOpen(true)} />
      <main id="main-content" className="main-content" tabIndex={-1}>
        <header className="workspace-header">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span aria-hidden="true">/</span>
            <strong>{game ? "Game review" : "Welcome"}</strong>
          </div>
          <div className="workspace-status">
            <span className="tiny-dot" /> A space to get better
          </div>
        </header>
        {model.error && !importOpen && <ErrorNotice>{model.error}</ErrorNotice>}
        {!game ? (
          <Welcome
            loading={model.loading}
            tryDemo={() => void model.loadDemo()}
            openImport={() => setImportOpen(true)}
          />
        ) : (
          <>
            <div className="review-heading">
              <div>
                <p className="eyebrow">Every game is a chance to grow</p>
                <h1>
                  Your game, <em>in focus.</em>
                </h1>
                <p className="review-subtitle">
                  {game.white}
                  <span>vs</span>
                  {game.black}
                  <Tag>{game.result}</Tag>
                </p>
              </div>
              {model.loading ? (
                <Spinner label="Loading game" />
              ) : (
                <span className="review-mode">
                  {model.health?.engine_mode === "stockfish"
                    ? "Stockfish analysis available"
                    : "Material-only demo · honest by design"}
                </span>
              )}
            </div>
            <div className="study-grid" aria-busy={model.loading}>
              <div className="board-column">
                <GameBoard model={model} />
                <FullGameAnalysis model={model} />
              </div>
              <div className="coach-column">
                <EnginePanel model={model} />
                <CoachPanel model={model} />
                <PracticePanel model={model} />
              </div>
            </div>
          </>
        )}
        <InsightsPanel model={model} />
        <footer className="workspace-footer">
          <span>Play with curiosity. Review with purpose.</span>
          <span>
            chesscoach <span aria-hidden="true">♞</span>
          </span>
        </footer>
      </main>
      {importOpen && (
        <ImportDialog
          close={() => setImportOpen(false)}
          onImport={model.importPgn}
          loading={model.loading}
          error={model.error}
        />
      )}
    </div>
  );
}
