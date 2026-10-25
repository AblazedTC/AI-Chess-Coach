"use client";

import { useEffect, useRef, useState } from "react";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { useWorkspace } from "@/hooks/use-workspace";
import { CoachPanel } from "./coach-panel";
import { EnginePanel, FullGameAnalysis } from "./analysis-panel";
import { GameBoard, MoveList } from "./game-board";
import { ImportDialog } from "./import-dialog";
import { InsightsPanel } from "./insights-panel";
import { Library } from "./library";
import { PracticePanel } from "./practice-panel";
import { ErrorNotice, Spinner, Tag } from "./ui";
import { Welcome } from "./welcome";

type Tool = "moves" | "engine" | "review" | "coach" | "practice" | "insights";

export function Workspace() {
  const model = useWorkspace();
  const layout = useResponsiveLayout();
  const [importOpen, setImportOpen] = useState(false);
  const [requestedTool, setTool] = useState<Tool>("moves");
  const [navigation, setNavigation] = useState<{ view: "review" | "insights" } | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (navigation)
      document
        .getElementById(navigation.view === "insights" ? "panel-insights" : "main-content")
        ?.focus();
  }, [navigation]);
  const tool =
    (requestedTool === "engine" && layout !== "narrow") ||
    (requestedTool === "coach" && layout === "three")
      ? "moves"
      : requestedTool;
  const tabs: { id: Tool; label: string }[] = [
    { id: "moves", label: "Moves" },
    ...(layout === "narrow" ? [{ id: "engine" as const, label: "Engine" }] : []),
    { id: "review", label: "Review" },
    ...(layout !== "three" ? [{ id: "coach" as const, label: "Coach" }] : []),
    { id: "practice", label: "Practice" },
    { id: "insights", label: "Insights" },
  ];
  const game = model.state.game;
  return (
    <div className={`app-shell ${game ? "review-workspace" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to workspace
      </a>
      <Library
        model={model}
        openImport={() => setImportOpen(true)}
        insightsActive={Boolean(game) && tool === "insights"}
        onView={
          game
            ? (view) => {
                setTool(view === "insights" ? "insights" : "moves");
                setNavigation({ view });
              }
            : undefined
        }
      />
      <main id="main-content" className="main-content" tabIndex={-1}>
        <header className="workspace-header">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span aria-hidden="true">/</span>
            <strong>{game ? "Game review" : "Welcome"}</strong>
          </div>
          <div className="workspace-status">
            <span
              className={`connection-dot ${model.healthError ? "offline" : !model.health ? "connecting" : ""}`}
            />
            {model.healthError
              ? "Chess service unavailable"
              : !model.health
                ? "Connecting to chess service"
                : model.health.engine_mode === "stockfish"
                  ? "Stockfish connected"
                  : "Offline demo · material only"}
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
                <h1>Game review</h1>
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
                  {model.healthError
                    ? "Analysis service unavailable"
                    : !model.health
                      ? "Connecting to analysis service"
                      : model.health.engine_mode === "stockfish"
                        ? "Stockfish analysis available"
                        : "Material-only demo · honest by design"}
                </span>
              )}
            </div>
            <div className="study-grid" data-layout={layout} aria-busy={model.loading}>
              <div className="board-column">
                <GameBoard model={model} />
              </div>
              <div className="tools-column">
                <div
                  className="tool-tabs"
                  role="tablist"
                  aria-label="Analysis tools"
                  data-shortcuts="ignore"
                  ref={tabsRef}
                >
                  {tabs.map((tab, index) => (
                    <button
                      key={tab.id}
                      id={`tab-${tab.id}`}
                      role="tab"
                      aria-selected={tool === tab.id}
                      aria-controls={`panel-${tab.id}`}
                      tabIndex={tool === tab.id ? 0 : -1}
                      onClick={() => setTool(tab.id)}
                      onKeyDown={(event) => {
                        if (event.altKey || event.ctrlKey || event.metaKey) return;
                        let next: number;
                        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
                        else if (event.key === "ArrowLeft")
                          next = (index + tabs.length - 1) % tabs.length;
                        else if (event.key === "Home") next = 0;
                        else if (event.key === "End") next = tabs.length - 1;
                        else return;
                        event.preventDefault();
                        setTool(tabs[next].id);
                        tabsRef.current
                          ?.querySelectorAll<HTMLButtonElement>("[role=tab]")
                          [next]?.focus();
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="tools-body">
                  <div
                    className="tool-pane moves-pane"
                    role="tabpanel"
                    id="panel-moves"
                    aria-labelledby="tab-moves"
                    tabIndex={0}
                    hidden={tool !== "moves"}
                  >
                    {layout !== "narrow" && <EnginePanel model={model} />}
                    <MoveList model={model} active={tool === "moves"} />
                  </div>
                  <div
                    className="tool-pane engine-pane"
                    role="tabpanel"
                    id="panel-engine"
                    aria-labelledby={layout === "narrow" ? "tab-engine" : undefined}
                    tabIndex={0}
                    hidden={tool !== "engine"}
                  >
                    {layout === "narrow" && <EnginePanel model={model} />}
                  </div>
                  <div
                    className="tool-pane review-pane"
                    role="tabpanel"
                    id="panel-review"
                    aria-labelledby="tab-review"
                    tabIndex={0}
                    hidden={tool !== "review"}
                  >
                    <FullGameAnalysis model={model} />
                  </div>
                  <div
                    className="tool-pane coach-pane"
                    role={layout === "three" ? undefined : "tabpanel"}
                    id="panel-coach"
                    aria-labelledby={layout === "three" ? undefined : "tab-coach"}
                    hidden={layout !== "three" && tool !== "coach"}
                  >
                    <CoachPanel model={model} />
                  </div>
                  <div
                    className="tool-pane practice-pane"
                    role="tabpanel"
                    id="panel-practice"
                    aria-labelledby="tab-practice"
                    tabIndex={0}
                    hidden={tool !== "practice"}
                  >
                    <PracticePanel model={model} />
                  </div>
                  <div
                    className="tool-pane insights-pane"
                    role="tabpanel"
                    id="panel-insights"
                    aria-labelledby="tab-insights"
                    tabIndex={0}
                    hidden={tool !== "insights"}
                  >
                    <InsightsPanel model={model} />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
        {!game && <InsightsPanel model={model} />}
        <footer className="workspace-footer" hidden={Boolean(game)}>
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
