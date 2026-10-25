import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const child = spawn(
  process.execPath,
  [
    fileURLToPath(new URL("../node_modules/concurrently/dist/bin/concurrently.js", import.meta.url)),
    "--kill-others",
    "--names",
    "backend,frontend",
    "uv --directory backend run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8100",
    "npm --prefix frontend run dev -- --hostname 127.0.0.1 --port 3100",
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      CHESSCOM_MODE: process.env.CHESSCOM_MODE ?? "demo",
      ENGINE_MODE: process.env.ENGINE_MODE ?? "demo",
      LLM_PROVIDER: process.env.LLM_PROVIDER ?? "deterministic",
      NEXT_PUBLIC_API_BASE_URL:
        process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8100",
    },
  },
);

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
