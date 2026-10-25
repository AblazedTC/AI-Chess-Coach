"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="fatal-error">
      <span className="brand-mark" aria-hidden="true">
        ♞
      </span>
      <h1>Let&apos;s reset the board.</h1>
      <p>The workspace hit an unexpected problem. Your original games have not changed.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
