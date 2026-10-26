# Setup and user guide

Run Chess Coach on your own Windows computer. Start with the offline demo, then
enable real Chess.com games, native Stockfish, and Anthropic independently.
All commands below use PowerShell from the repository root unless noted.

## Install the prerequisites

Install:

- [Git](https://git-scm.com/downloads).
- [Node.js](https://nodejs.org/en/download): 22.22.2+ within 22.x,
  24.15.0+ within 24.x, or 26+. Node 24 LTS is a suitable choice.
- [uv](https://docs.astral.sh/uv/getting-started/installation/) for Python
  dependency management. The backend requires Python 3.13; `uv` can download it.

Open a new PowerShell terminal after installing these tools:

```powershell
git --version
node --version
npm --version
uv --version
```

The first installation needs internet access to download dependencies. Stockfish
and an Anthropic key are optional, not prerequisites for the demo.

## First launch

Clone the private repository using a GitHub account that has access:

```powershell
git clone https://github.com/AblazedTC/chess-takehome-recreated.git
Set-Location chess-takehome-recreated
```

If you already downloaded or cloned it, open a terminal in the folder containing
`package.json`, `backend`, and `frontend`; do not clone it again.

Install the locked dependencies:

```powershell
uv --directory backend sync --locked
npm ci
npm --prefix frontend ci
```

Create the backend's local configuration without overwriting an existing one:

```powershell
if (-not (Test-Path backend\.env)) {
    Copy-Item backend\.env.example backend\.env
}
```

Start both services:

```powershell
npm run dev
```

Open **http://localhost:3000** and choose **Try demo**. Keep the terminal running.
Press **Ctrl+C** in that terminal to stop both services.

| Service                       | Address                          |
| ----------------------------- | -------------------------------- |
| Chess Coach                   | http://localhost:3000            |
| Backend health                | http://127.0.0.1:8000/api/health |
| Interactive API documentation | http://127.0.0.1:8000/docs       |

With the default configuration, username searches return synthetic demo data,
analysis counts material only, and coaching is deterministic. This lets you
explore without external accounts or paid requests.

## Enable real games, Stockfish, and Anthropic

Edit **`backend\.env`** in your editor. Changing `backend\.env.example` alone
does not change the running app. Restart the backend after saving; when using
`npm run dev`, stop it with Ctrl+C and run it again.

### Real Chess.com games

Set:

```dotenv
CHESSCOM_MODE=live
```

Enter a public Chess.com username in **Chess.com username**, choose **Search games**,
and open a game from the results. No Chess.com password or API key is needed.
The app reads at most the two most recent available monthly archives and returns
up to 20 standard-chess games, not the account's entire history.

You can also import a standard-chess PGN with **Import PGN**. This works without
live Chess.com access.

### Native Stockfish analysis

Download a Windows build from the [official Stockfish site](https://stockfishchess.org/download/)
and extract it. Choose a build compatible with your computer.

Point the backend at the actual `.exe`, not its ZIP file or containing folder:

```dotenv
ENGINE_MODE=stockfish
STOCKFISH_PATH=C:\tools\stockfish\stockfish-windows-x86-64-universal.exe
ENGINE_DEPTH=12
ENGINE_TIME_SECONDS=0.3
ENGINE_TIMEOUT_SECONDS=10
```

Replace the sample path with your extracted executable's actual path and filename.
An unquoted Windows path, as above, avoids double-quoted backslash escape sequences.
Stockfish runs locally; no Stockfish account or network API key is required.

**Use `stockfish`, not `live`, for `ENGINE_MODE`.** Engine depth and time are
bounded search limits, not a guarantee that every evaluation is definitive.

### Anthropic coaching

Create an API key through the [Anthropic Console](https://console.anthropic.com/)
and ensure the API account has available credits. Claude chat subscriptions and
API billing are separate.

Set these fields in your local `backend\.env`:

```dotenv
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=replace-with-your-own-key
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
```

Replace the placeholder locally. If that model is unavailable to your API account,
choose a compatible Anthropic Messages API model that supports tool use.
Do not enable `LLM_PROVIDER=anthropic` with an empty key: startup validation will
reject it.

The backend sends the question, bounded conversation history, and verified
position evidence to Anthropic. Requests can incur charges. The model explains
the chess idea, a concrete consequence or alternative, and one practical
takeaway. Board/engine evidence is checked, but the AI's interpretation can
still be wrong.

Never put the key in a `NEXT_PUBLIC_` variable, commit it, or include it in
screenshots or support messages. Confirm that the local file is ignored:

```powershell
git check-ignore backend\.env
```

### Complete configuration example

To enable all three features, your local file needs these values, adjusted for
your own executable and API key:

```dotenv
CHESSCOM_MODE=live
ENGINE_MODE=stockfish
STOCKFISH_PATH=C:\tools\stockfish\stockfish-windows-x86-64-universal.exe
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=replace-with-your-own-key
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
```

To return to the fully offline demo, set:

```dotenv
CHESSCOM_MODE=demo
ENGINE_MODE=demo
LLM_PROVIDER=deterministic
```

You can mix modes: for example, live Chess.com imports and Stockfish with
deterministic coaching require no Anthropic key.

### Confirm the running modes

After restarting:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
```

With Stockfish and Anthropic enabled, expect `engine_mode` to be `stockfish`
and `coach_mode` to be `anthropic`. Health reports configured modes; it does not
prove that the Stockfish executable or Anthropic credentials work. Analyze a
position and ask a coach question to check those integrations.

The health response does not include the Chess.com mode. Confirm live imports
by searching a real username; a profile named **Demo Player** indicates demo data.

## Study a game

1. **Load a game.** Search a username, import a PGN, or choose Try demo.
2. **Replay a decision.** Click the move list or use the previous/next controls.
   Arrow keys step through moves, Home/End jump, and F flips the board. Shortcuts
   do not intercept typing in form fields.
3. **Ask why.** Select the position after the move you want explained. Ask
   "Why was the last move bad?", "What does the alternative protect?", or
   "What should I learn here?" A good move should not be called bad just because
   the question assumes it was.
4. **Inspect the evidence.** Expand Position evidence for citations and suggested
   moves. Comparing a played move can cite both the current and previous positions;
   a citation navigates to its own position.
5. **Practice separately.** Open Practice and start a variation. Click the piece
   and destination, or enter UCI such as `e2e4`. Click promotion defaults to queen;
   use UCI such as `e7e8n` to underpromote. Reset practice restores its starting
   position without changing the original game.
6. **Review the whole game.** Start full-game analysis in Review, then use the
   graph and key moments to inspect decisions. You can cancel the analysis job.
7. **Compare games.** Select up to 10 library games and open Insights. Themes
   describe supported game events, not a proven diagnosis of your habits.

On smaller screens, use the tool tabs to reach Coach, Review, Practice, and
Insights. A conversation stays with its selected position while the app is open.
Questions are limited to 2,000 characters. Practice variations allow up to 100 moves.

Scores use White's perspective even when the board is flipped. A negative
evaluation favors Black. Mate scores are not centipawn scores, and move
classifications are this app's heuristics, not Chess.com's classification system.

If Anthropic is unavailable or an answer cannot pass grounding checks, the app
shows a warning and a deterministic explanation from the evidence. Demo move
suggestions are legal examples, not engine-verified recommendations.

## Start services separately

For separate logs, use two terminals at the repository root.

Backend:

```powershell
uv --directory backend run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
```

Frontend:

```powershell
npm --prefix frontend run dev -- --hostname 127.0.0.1 --port 3000
```

Do not also run `npm run dev` at the same time. Stop each separate terminal
with Ctrl+C when finished. Use one backend worker: game state and jobs are
process-local.

The frontend defaults to `http://127.0.0.1:8000` for API requests. To change it,
set `NEXT_PUBLIC_API_BASE_URL` before starting or building Next.js, and configure
`CORS_ORIGINS` in `backend\.env` for the frontend's exact local origin. For example:

```dotenv
CORS_ORIGINS=["http://localhost:3000","http://127.0.0.1:3000"]
```

This public frontend URL is not a secret. API keys belong only in backend
configuration. The backend only accepts explicitly configured local CORS origins.

## Troubleshooting

| Symptom                                                | What to check                                                                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uv`, `node`, `npm`, or `git` is not recognized        | Install the prerequisite and reopen the terminal so its updated PATH is available.                                                                 |
| Private repository clone fails                         | Confirm that your GitHub account has repository access and Git is authenticated.                                                                   |
| Username searches show sample games                    | Set `CHESSCOM_MODE=live` in `backend\.env`, then restart. Demo searches accept usernames but do not fetch their real history.                      |
| Real username lookup fails                             | Check spelling, public account availability, internet access, and the displayed provider error. Rate limiting may require waiting before retrying. |
| Startup rejects `ENGINE_MODE=live`                     | Change it to `stockfish`, or `demo` for material-only analysis.                                                                                    |
| Stockfish is unavailable                               | Confirm `STOCKFISH_PATH` names an extracted, compatible executable. Health alone does not launch the engine.                                       |
| Startup rejects Anthropic configuration                | Add a nonempty key, or set `LLM_PROVIDER=deterministic` until one is available.                                                                    |
| Coach falls back to deterministic                      | Read the warning. Check API credits, key validity, model access, and connectivity. Unsupported output or a timeout can also trigger fallback.      |
| `.env` changes seem ignored                            | Restart the backend. PowerShell environment variables override `.env`; clear an old override such as `$env:ENGINE_MODE = $null`, then restart.     |
| The frontend cannot reach the backend                  | Check `/api/health`, the API base URL, and exact CORS origins. Both services must be running.                                                      |
| Port 3000 or 8000 is already in use                    | Stop your earlier instance with Ctrl+C in its terminal. Do not start another copy on top of it.                                                    |
| Next.js reports a development lock                     | Stop the existing frontend before starting another dev server or running browser tests.                                                            |
| A game disappears or its ID is not found after restart | Imports, evaluations, and jobs are in memory. Refresh the app and import or search for the game again.                                             |

Do not share API keys or dump the contents of `.env` when reporting a problem.
The backend terminal and displayed error/warning are usually enough to identify
the failing integration.

## Update or check your installation

After saving your own source changes, pull updates and reinstall from lockfiles:

```powershell
git pull --ff-only
uv --directory backend sync --locked
npm ci
npm --prefix frontend ci
```

Stop the app before reinstalling dependencies. Keep your local `.env`; the
example may add optional settings you can copy over individually.

Stop the running app before development checks:

```powershell
npm run lint
npm test
npm run build
```

Stop the frontend dev server before browser checks. They start their own
services on ports 3100 and 8100, but share the Next.js development lock:

```powershell
npx playwright install chromium
npm run test:e2e
```

Browser checks explicitly use demo providers. Tests normally use mocked external
services; native-engine integration tests can use an operator-supplied
`STOCKFISH_PATH`. See the [backend README](backend/README.md) and
[frontend README](frontend/README.md) for component-specific checks.

## Storage, privacy, and operating limits

This is a local study application, not a hosted multi-user service. It has no
authentication or durable game database. Backend restarts clear imports and jobs;
browser refreshes can clear the current workspace. Keep original PGNs elsewhere
if you want to study them again later.

Do not expose the backend or frontend directly to the public internet. A public
deployment would need authentication, authorization, durable storage, and
deployment-level rate limits. Neither Stockfish nor an Anthropic key turns this
local application into a public service.
