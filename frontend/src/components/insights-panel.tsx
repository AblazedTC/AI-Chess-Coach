import type { WorkspaceModel } from "@/hooks/use-workspace";
import { MAX_INSIGHT_GAMES } from "@/lib/limits";
import { ErrorNotice, SectionHeading, Spinner, Tag } from "./ui";

export function InsightsPanel({ model }: { model: WorkspaceModel }) {
  return (
    <section className="panel insights-panel" id="insights" aria-label="Insights">
      <SectionHeading eyebrow="Build better habits" title="Small patterns. Lasting progress.">
        <button
          className="button secondary"
          aria-label="Insights"
          disabled={!model.insightIds.length || model.insightsLoading}
          onClick={() => void model.getInsights()}
        >
          {model.insightsLoading ? (
            <Spinner label="Finding patterns" />
          ) : (
            <>
              Insights <span aria-hidden="true">↗</span>
            </>
          )}
        </button>
      </SectionHeading>
      <p className="muted">
        {model.insightIds.length
          ? `${model.insightIds.length} game${model.insightIds.length === 1 ? "" : "s"} selected.`
          : "Select games in the library."}{" "}
        Review up to {MAX_INSIGHT_GAMES} games at a time. Every theme links back to a position.
      </p>
      {model.insightsError && (
        <ErrorNotice retry={() => void model.getInsights()}>{model.insightsError}</ErrorNotice>
      )}
      {model.insights ? (
        <div className="insights-results" aria-live="polite">
          <div className="insights-summary">
            <span aria-hidden="true">✧</span>
            <div>
              <Tag tone="green">{model.insights.games_analyzed} games reviewed</Tag>
              <p>{model.insights.summary}</p>
            </div>
          </div>
          <div className="theme-grid">
            {model.insights.themes.map((theme, index) => (
              <article className="theme-card" key={`${theme.name}:${index}`}>
                <div className="theme-title">
                  <span className="theme-number">{String(index + 1).padStart(2, "0")}</span>
                  <Tag>
                    {theme.count} occurrence{theme.count === 1 ? "" : "s"}
                  </Tag>
                </div>
                <h3>{theme.name}</h3>
                <p>{theme.description}</p>
                <div className="theme-citations">
                  {theme.supporting_positions.map((citation, index) => (
                    <button
                      key={`${citation.game_id}:${citation.ply}:${index}`}
                      className="citation-button"
                      disabled={model.loading}
                      onClick={() => model.selectCitation(citation)}
                      title={citation.position_key}
                    >
                      <span aria-hidden="true">⌖</span> Position {citation.ply}
                      <span aria-hidden="true">↗</span>
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
          {!model.insights.themes.length && (
            <p className="honesty-note">
              No supported themes were found in these games. That&apos;s not a judgment of your
              play.
            </p>
          )}
          {model.insights.limitations.length > 0 && (
            <div className="insights-limitations">
              <h3>What this can &amp; can&apos;t tell you</h3>
              <ul>
                {model.insights.limitations.map((limitation, index) => (
                  <li key={index}>{limitation}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="insights-empty">
          <span aria-hidden="true">↗</span>
          <div>
            <strong>Your games have something to teach you.</strong>
            <p>
              Look for recurring ideas, not just individual mistakes. Demo insights are limited to
              verifiable board facts, not engine judgments.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
