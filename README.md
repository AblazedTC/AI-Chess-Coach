# AI Chess Coach

Review your games, explore better moves, and learn from explanations tied to
the position on the board.

- Import PGN or browse a Chess.com player's recent games.
- Replay moves, flip the board, and explore variations without changing the game.
- Analyze positions and full games with Stockfish.
- Learn why a move matters: piece safety, central pawn support, development,
  and the opponent's reply, with position-specific evidence.
- Find recurring themes across games and revisit the supporting positions.

**New here?** Follow the [setup and user guide](GUIDE.md) for installation,
real Chess.com games, Stockfish, Anthropic, everyday usage, and troubleshooting.

## Run locally

Requires Git, [uv](https://docs.astral.sh/uv/), Python 3.13, and Node.js
22.22.2+ (22.x), 24.15.0+ (24.x), or 26+. `uv` can install the required Python.
These commands use Windows PowerShell.

```powershell
git clone https://github.com/AblazedTC/AI-Chess-Coach.git
Set-Location AI-Chess-Coach
uv --directory backend sync --locked
npm ci
npm --prefix frontend ci
if (-not (Test-Path backend\.env)) {
    Copy-Item backend\.env.example backend\.env
}
npm run dev
```

The repository is private; cloning requires an account with access.
For an existing checkout, follow the
[remote update instructions](GUIDE.md#existing-checkouts-after-the-rename)
instead of cloning again.
Open **http://localhost:3000**. The backend runs on **http://127.0.0.1:8000**;
interactive API documentation is at **http://127.0.0.1:8000/docs**.
Keep the terminal open; press **Ctrl+C** to stop both services.

After dependencies are installed, the default demo needs no account, API key,
engine installation, or network connection. **Username searches in demo mode
return sample data, not the player's real games.** Demo analysis is material-only,
not a Stockfish evaluation, and demo suggestions are not engine recommendations.

## Enable real games, analysis, and AI

Edit **`backend\.env`**, not the example file. The three providers are independent:

| Feature                        | Local configuration                              | Requirement                                                               |
| ------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------- |
| Real Chess.com username lookup | `CHESSCOM_MODE=live`                             | Internet; no Chess.com login or API key                                   |
| Native chess analysis          | `ENGINE_MODE=stockfish` and `STOCKFISH_PATH`     | An extracted [Stockfish executable](https://stockfishchess.org/download/) |
| AI explanations                | `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` | An Anthropic API account with available credits                           |

Restart `npm run dev` after changing backend configuration. **`live` is not a
valid engine setting**; use `stockfish`. See the
[complete configuration example](GUIDE.md#complete-configuration-example).

Never commit `.env` or put API keys in the frontend. Anthropic calls can incur
charges; a subscription to the Claude chat application is not an API key.

Scores are always from White's perspective. Mate scores are distinct from
centipawn evaluations. Move classifications are heuristics, not Chess.com's
classification system.

## Render and Stockfish

The backend Docker image installs Linux Stockfish and runs as a non-root user.
See [Render setup](GUIDE.md#render-and-linux-stockfish) for the exact dashboard
settings, container verification, and remaining public-deployment requirements.
Local `.env` files and Windows executables are not included in the image.

## Development checks

```powershell
npm run lint
npm test
npm run build
```

Stop the frontend dev server before running browser tests:

```powershell
npx playwright install chromium
npm run test:e2e
```

Tests use offline data and mocked external providers by default. Browser tests
start isolated services on ports 8100 and 3100, but share the frontend's Next.js
development lock with the normal dev server. CI runs on pushes and pull requests.

Component details: [backend README](backend/README.md) and
[frontend README](frontend/README.md).

## Architecture

The Next.js frontend handles presentation and interaction. The FastAPI backend
owns chess rules, PGN parsing, imports, engine access, coaching evidence, and
analysis jobs. `python-chess` is the authority for legal moves and board state.
Coaching cannot turn an unverified suggestion into an engine-backed claim.
AI explanations interpret verified board facts and bounded engine lines;
their reasoning can still be wrong.

State is held in bounded, in-memory storage. Restarting the backend clears
imported games and jobs. This is a local, single-process application without
authentication; do not expose it directly to the public internet.
