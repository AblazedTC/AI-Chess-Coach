import type { WorkspaceModel } from "@/hooks/use-workspace";
import { formatScore, isActiveJob, scoreHeight } from "@/lib/chess";
import { ErrorNotice, SectionHeading, Spinner, Tag } from "./ui";

export function EnginePanel({ model }: { model: WorkspaceModel }) {
  const { analysis, analysisError } = model;
  return (
    <section className="panel engine-panel" aria-label="Position analysis">
      <SectionHeading title="Position check">
        <Tag tone={analysis?.source === "stockfish" ? "green" : ""}>
          {analysis
            ? analysis.source === "demo"
              ? "Material-only demo"
              : "Stockfish"
            : "Analysis"}
        </Tag>
      </SectionHeading>
      {analysisError ? (
        <ErrorNotice retry={model.retryAnalysis}>{analysisError}</ErrorNotice>
      ) : !analysis ? (
        <Spinner label="Checking this position" />
      ) : (
        <>
          <div className="score-row">
            <span className="score-number">{formatScore(analysis.score)}</span>
            <div>
              <strong>
                {analysis.source === "demo" ? "Material balance" : "Engine evaluation"}
              </strong>
              <small>
                White&apos;s perspective
                {analysis.depth !== null ? ` · depth ${analysis.depth}` : ""}
              </small>
            </div>
            <span className="balance-icon" aria-hidden="true">
              ⚖
            </span>
          </div>
          {analysis.source === "demo" ? (
            <p className="honesty-note">
              Demo counts material only. It does not assess position quality, identify mistakes, or
              recommend engine-verified moves.
            </p>
          ) : (
            <>
              {analysis.classification && (
                <p className="analysis-detail">
                  {analysis.classification}
                  {analysis.loss_cp !== null
                    ? ` · ${(analysis.loss_cp / 100).toFixed(2)} pawn loss`
                    : ""}
                </p>
              )}
              {analysis.best_move && (
                <p className="analysis-detail">
                  Best move <code>{analysis.best_move}</code>
                </p>
              )}
              {analysis.lines.map((line, index) => (
                <p className="engine-line" key={index}>
                  <span>{formatScore(line.score)}</span> {line.san.join(" ") || line.uci.join(" ")}
                </p>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}

export function FullGameAnalysis({
  model,
}: {
  model: Pick<
    WorkspaceModel,
    | "state"
    | "jobStarting"
    | "analyzeGame"
    | "jobCancelling"
    | "cancelAnalysis"
    | "jobError"
    | "retryJob"
    | "navigate"
  >;
}) {
  const { state } = model;
  const job = state.job;
  const active = isActiveJob(job?.status);
  const analyses = Object.values(state.analyses).sort((a, b) => a.ply - b.ply);
  const hasStockfish = analyses.some((analysis) => analysis.source === "stockfish");
  const keyMoments = analyses
    .filter((analysis) => analysis.source === "stockfish" && (analysis.loss_cp ?? 0) >= 100)
    .sort((a, b) => (b.loss_cp ?? 0) - (a.loss_cp ?? 0))
    .slice(0, 4);
  const labels = {
    queued: "Analysis queued",
    running: "Analyzing game",
    completed: "Analysis completed",
    cancelled: "Analysis cancelled",
    failed: "Analysis failed",
  };
  return (
    <section className="panel full-game-panel" aria-label="Full-game analysis">
      <SectionHeading eyebrow="The bigger picture" title="Game overview">
        <button
          className="button secondary small"
          disabled={model.jobStarting || active}
          onClick={() => void model.analyzeGame()}
          aria-label="Analyze game"
        >
          {model.jobStarting ? (
            <Spinner label="Starting" />
          ) : active ? (
            "Analyzing…"
          ) : (
            "Analyze game"
          )}
        </button>
      </SectionHeading>
      {job && (
        <div className="job-progress">
          <div className="progress-label">
            <span role="status">{labels[job.status]}</span>
            <small>
              {job.completed} / {job.total} positions
            </small>
          </div>
          <progress
            aria-label="Game analysis progress"
            value={job.completed}
            max={Math.max(1, job.total)}
          />
          {active && (
            <button
              className="text-button"
              onClick={() => void model.cancelAnalysis()}
              disabled={model.jobCancelling}
            >
              {model.jobCancelling ? "Cancelling…" : "Cancel analysis"}
            </button>
          )}
          {job.error && <ErrorNotice>{job.error}</ErrorNotice>}
        </div>
      )}
      {model.jobError && <ErrorNotice retry={model.retryJob}>{model.jobError}</ErrorNotice>}
      <div className="graph-header">
        <span>{hasStockfish ? "Evaluation" : "Material balance"}</span>
        <small>White ↑ · Black ↓</small>
      </div>
      <div
        className="eval-graph"
        role="region"
        tabIndex={0}
        data-shortcuts="ignore"
        aria-describedby="graph-help"
        aria-label={
          hasStockfish ? "White perspective evaluation graph" : "Demo material balance graph"
        }
      >
        <div
          className="graph-track"
          style={{ minWidth: analyses.length ? `${analyses.length * 24}px` : undefined }}
        >
          <div className="graph-zero" aria-hidden="true" />
          {analyses.length ? (
            analyses.map((analysis) => {
              const turn = state.game?.positions.find(
                (position) => position.ply === analysis.ply,
              )?.turn;
              const height = scoreHeight(analysis, turn);
              return (
                <button
                  key={analysis.ply}
                  className={`graph-column ${analysis.ply === state.ply ? "selected" : ""}`}
                  aria-label={`Position ${analysis.ply}, ${analysis.source === "demo" ? "material" : "evaluation"} ${formatScore(analysis.score)}`}
                  title={`Position ${analysis.ply}: ${formatScore(analysis.score)}`}
                  onClick={() => model.navigate(analysis.ply)}
                >
                  {height === null ? (
                    <span
                      className="graph-unknown"
                      aria-label="Mate outcome unavailable without position context"
                    >
                      ?
                    </span>
                  ) : (
                    <>
                      <span className="graph-fill" style={{ top: `${height}%`, bottom: 0 }} />
                      <span className="graph-point" style={{ top: `${height}%` }} />
                    </>
                  )}
                </button>
              );
            })
          ) : (
            <p className="graph-placeholder">Analyze the game to see the whole picture.</p>
          )}
        </div>
      </div>
      <p id="graph-help" className="field-hint">
        Swipe or scroll horizontally to explore all positions. Tab to a position and press Enter to
        select.
      </p>
      <div className="graph-footer">
        <small>Opening</small>
        <small>Latest analyzed position</small>
      </div>
      <h3 className="key-moments-title">Key moments</h3>
      {keyMoments.length ? (
        <div className="key-moments">
          {keyMoments.map((moment) => (
            <button key={moment.ply} onClick={() => model.navigate(moment.ply)}>
              <span>Position {moment.ply}</span>
              <strong>{moment.classification || "Opportunity"}</strong>
              <small>{formatScore(moment.score)} →</small>
            </button>
          ))}
        </div>
      ) : (
        <p className="honesty-note">
          {hasStockfish
            ? "No large evaluation losses found in the analyzed positions."
            : "Key moments need a real engine. Demo material changes are not mistake classifications."}
        </p>
      )}
    </section>
  );
}
