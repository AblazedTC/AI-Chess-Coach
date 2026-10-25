import { START_FEN } from "@/lib/chess";
import { Board } from "./board";
import { Spinner, Tag } from "./ui";

export function Welcome({
  loading,
  tryDemo,
  openImport,
}: {
  loading: boolean;
  tryDemo: () => void;
  openImport: () => void;
}) {
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <div className="welcome-copy">
        <Tag tone="green">
          <span className="tiny-dot" /> A little study. A stronger game.
        </Tag>
        <h1 id="welcome-title">
          Every move
          <br />
          has a <em>lesson.</em>
        </h1>
        <p>
          Go beyond the result. Revisit your games, understand your decisions, and find a better
          next move.
        </p>
        <div className="welcome-actions">
          <button className="button primary large" onClick={tryDemo} disabled={loading}>
            {loading ? (
              <Spinner label="Opening demo" />
            ) : (
              <>
                Try demo <span aria-hidden="true">→</span>
              </>
            )}
          </button>
          <button className="button secondary large" onClick={openImport}>
            Import your game
          </button>
        </div>
        <p className="welcome-note">No account. No setup. Just you and the board.</p>
        <div className="welcome-features">
          <div>
            <span aria-hidden="true">◎</span>
            <strong>See the whole story</strong>
            <small>Replay each decision, at your pace.</small>
          </div>
          <div>
            <span aria-hidden="true">✧</span>
            <strong>Ask better questions</strong>
            <small>Position-grounded, honest coaching.</small>
          </div>
          <div>
            <span aria-hidden="true">↗</span>
            <strong>Make it a habit</strong>
            <small>Try ideas in a safe practice board.</small>
          </div>
        </div>
      </div>
      <div className="welcome-board">
        <div className="preview-label">
          <span className="tiny-dot" /> YOUR NEXT CHAPTER STARTS HERE
        </div>
        <Board fen={START_FEN} label="Welcome chess board" />
        <div className="welcome-board-caption">
          <span aria-hidden="true">♞</span>
          <div>
            <strong>A fresh perspective on your chess.</strong>
            <small>One position at a time.</small>
          </div>
        </div>
      </div>
    </section>
  );
}
