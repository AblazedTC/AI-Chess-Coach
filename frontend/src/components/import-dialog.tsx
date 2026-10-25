"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorNotice, Spinner } from "./ui";

export function ImportDialog({
  close,
  onImport,
  loading,
  error,
}: {
  close: () => void;
  onImport: (pgn: string) => Promise<boolean>;
  loading: boolean;
  error: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pgn, setPgn] = useState("");

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="import-dialog"
      aria-labelledby="import-title"
      onCancel={close}
      onClick={(event) => {
        if (event.target === event.currentTarget && !loading) close();
      }}
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">Bring your own game</p>
          <h2 id="import-title">Import PGN</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close import"
          onClick={close}
          disabled={loading}
        >
          ×
        </button>
      </div>
      <p className="muted">
        Paste a complete game or a short line. We&apos;ll build a board for every move.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (await onImport(pgn.trim())) close();
        }}
      >
        <label htmlFor="pgn">PGN</label>
        <textarea
          id="pgn"
          className="pgn-input"
          value={pgn}
          onChange={(event) => setPgn(event.target.value)}
          placeholder={'[White "You"]\n[Black "Opponent"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *'}
          required
          maxLength={250000}
          spellCheck={false}
          autoFocus
        />
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={close} disabled={loading}>
            Cancel
          </button>
          <button className="button primary" disabled={loading || !pgn.trim()}>
            {loading ? <Spinner label="Importing" /> : "Import PGN"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
