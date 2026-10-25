import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const modes = ["CHESSCOM_MODE", "ENGINE_MODE", "LLM_PROVIDER", "NEXT_PUBLIC_API_BASE_URL"];
const probe = `
  import assert from "node:assert/strict";
  import childProcess from "node:child_process";
  import { EventEmitter } from "node:events";
  import { syncBuiltinESMExports } from "node:module";
  import { resolve } from "node:path";
  import { pathToFileURL } from "node:url";

  let calls = 0;
  childProcess.spawn = (executable, args, options) => {
    calls += 1;
    assert.equal(executable, process.execPath);
    assert.ok(args.includes("--kill-others"));
    assert.ok(args.some((arg) => arg.includes("uv --directory backend")));
    assert.ok(args.some((arg) => arg.includes("npm --prefix frontend")));
    assert.equal(resolve(options.cwd), process.cwd());
    assert.equal(options.stdio, "inherit");
    assert.ok(!Object.hasOwn(options, "env"), "Child must inherit environment without overrides");
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0));
    return child;
  };
  syncBuiltinESMExports();
  const before = { ...process.env };
  await import(pathToFileURL(resolve("qa", "dev.mjs")).href);
  assert.equal(calls, 1);
  assert.deepEqual({ ...process.env }, before);
`;

for (const configured of [false, true]) {
  test(`dev inherits ${configured ? "explicit" : "unset"} modes without replacing saved configuration`, () => {
    const env = {};
    for (const key of ["PATH", "SystemRoot", "WINDIR"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    if (configured) {
      for (const key of modes) env[key] = `test-configured-${key.toLowerCase()}`;
    }
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", probe], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
  });
}
