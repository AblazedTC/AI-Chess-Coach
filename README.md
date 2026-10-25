# Chess Coach

Review your games, explore better moves, and learn from explanations tied to
the position on the board.

- Import PGN or browse a Chess.com player's recent games.
- Replay moves, flip the board, and explore variations without changing the game.
- Analyze positions and full games with Stockfish.
- Ask position-specific questions and inspect the evidence behind coaching.
- Find recurring themes across games and revisit the supporting positions.

## Run locally

Requires Python 3.13, [uv](https://docs.astral.sh/uv/), and Node.js
22.22.2+ (22.x), 24.15+ (24.x), or 26+.

```powershell
uv --directory backend sync --locked
npm ci
npm --prefix frontend ci
npm run dev
```

Open **http://localhost:3000**. The backend runs on **http://127.0.0.1:8000**;
interactive API documentation is at **http://127.0.0.1:8000/docs**.

The default demo needs no account, API key, engine installation, or network
connection. Demo analysis is **material-only**, not a Stockfish evaluation.
Legal demo suggestions are not presented as engine-verified recommendations.

## Stockfish

Install [Stockfish](https://stockfishchess.org/download/) separately and set
the path to its executable before starting the backend:

```powershell
$env:ENGINE_MODE = "stockfish"
$env:STOCKFISH_PATH = "C:\tools\stockfish\stockfish.exe"
npm run dev
```

Scores are always from White's perspective. Mate scores are distinct from
centipawn evaluations. Move classifications are heuristics, not Chess.com's
classification system.

## Checks

```powershell
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Tests use offline data and mocked external providers by default. Browser tests
start their own backend and frontend. CI runs on pushes and pull requests.

## Architecture

The Next.js frontend handles presentation and interaction. The FastAPI backend
owns chess rules, PGN parsing, imports, engine access, coaching evidence, and
analysis jobs. `python-chess` is the authority for legal moves and board state.
Coaching cannot turn an unverified suggestion into an engine-backed claim.

State is held in bounded, in-memory storage. Restarting the backend clears
imported games and jobs. This is a local, single-process application without
authentication; do not expose it directly to the public internet.
