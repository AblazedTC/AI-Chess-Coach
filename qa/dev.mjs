import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const child = spawn(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/concurrently/dist/bin/concurrently.js", import.meta.url),
    ),
    "--kill-others",
    "--names",
    "backend,frontend",
    "uv --directory backend run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000",
    "npm --prefix frontend run dev -- --hostname 127.0.0.1 --port 3000",
  ],
  {
    cwd: root,
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
