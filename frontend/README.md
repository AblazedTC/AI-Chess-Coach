# AI Chess Coach frontend

A responsive, accessible chess study workspace built with Next.js App Router,
React, and strict TypeScript. Uses system fonts and react-chessboard's default SVG
pieces, bundled locally; builds never download fonts or require external services.

For complete installation, provider setup, and everyday usage, see the
[setup and user guide](../GUIDE.md).

## Run

Requires Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` and the backend running on
port 8000.

```powershell
npm --prefix frontend ci
npm --prefix frontend run dev -- --hostname 127.0.0.1 --port 3000
```

The API defaults to `http://127.0.0.1:8000`. To use another backend, set
`NEXT_PUBLIC_API_BASE_URL` before starting or building Next.js. This public
configuration is not a secret. No API keys belong in the frontend.

Choose **Try demo** to explore without a Chess.com account or any AI/engine
configuration. Demo analysis is explicitly **material-only**, not a positional
evaluation. Demo coach responses are deterministic, not an external model.
Stockfish and Anthropic are labeled only when reported by the backend.

## Study tools

- Search a Chess.com username, load a recent game, or import PGN.
- Navigate with the move list, previous/next buttons, arrow keys, Home, or End.
  Press F to flip. Shortcuts never intercept text entry or dialog interaction.
- Inspect per-position analysis, ask grounded coach questions, and revisit
  position-specific conversation history. Coach text is rendered as plain text.
- Start/cancel full-game analysis; select graph points and engine-supported key
  moments. All scores and graphs use White's perspective. Long graphs scroll
  horizontally; swipe, scroll, or Tab to reach every position.
- Open **Practice** to explore a separate board. Click a piece and destination or
  enter UCI (for example `e2e4`). Click promotion defaults to queen; use `e7e8n`
  to underpromote. Each variation supports up to 100 moves; **Reset practice**
  returns to the selected original position and clears that limit.
- Select library checkboxes and choose **Insights** for per-game or multi-game
  themes, up to 10 games at a time. Position citations navigate to their source
  game and position.

Coach questions are limited to 2,000 characters. Full responses remain visible,
but each history message sent with a follow-up is bounded to 2,000 characters.

Requests are abortable and selection-scoped; outdated responses cannot overwrite
a newly selected game or position. Leaving a game cancels its active analysis
job on a best-effort basis, including jobs whose creation finishes after leaving
or closing the workspace. Creation requests are allowed to return their job ID
so the resulting server job can be cancelled. Failed requests preserve the
original game.

## Validate

```powershell
Set-Location frontend
npm run lint
npm run format:check
npm run typecheck
npm test -- --run
npm run build
```

Tests cover board/FEN orientation, practice interaction, reducers, request
failures, navigation shortcuts, safe coach output, and stale-response guards.
Browser acceptance tests live in the root `qa` suite, not this package.

## Layout

- `src/lib`: fixed API-contract types, fetch client, board helpers, state reducer.
- `src/hooks/use-workspace.ts`: request lifecycle and scoped orchestration.
- `src/components`: independent library, board, coach, analysis, practice, and
  insights views.
- `src/app`: App Router entry points and responsive styles.

The frontend needs the documented backend API; it does not silently substitute
fake network responses. An unavailable backend is reported with a retryable
error. Practice legality and original-game integrity are enforced by the backend.
