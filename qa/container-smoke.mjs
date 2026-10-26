import assert from "node:assert/strict";

const baseUrl = process.argv[2];
assert.ok(baseUrl, "Usage: node qa/container-smoke.mjs <backend-url>");

async function request(path, body) {
  const response = await fetch(new URL(path, baseUrl), {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  assert.equal(response.status, 200, `${path}: ${text}`);
  return JSON.parse(text);
}

const health = await request("/api/health");
assert.equal(health.status, "ok");
assert.equal(health.engine_mode, "stockfish");
assert.equal(health.coach_mode, "deterministic");

const opening = await request("/api/games/import", { pgn: "1. e4 e5 *" });
const analysis = await request("/api/analysis/position", { game_id: opening.id, ply: 1 });
assert.equal(analysis.source, "stockfish");
assert.equal(analysis.position_key, opening.positions[1].position_key);
assert.ok(Number.isInteger(analysis.depth) && analysis.depth > 0);
assert.match(analysis.best_move, /^[a-h][1-8][a-h][1-8][qrbn]?$/);
assert.ok(analysis.lines.length > 0);
assert.equal(analysis.lines[0].uci[0], analysis.best_move);

const mate = await request("/api/games/import", {
  pgn: '[SetUp "1"]\n[FEN "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1"]\n\n*',
});
const mateAnalysis = await request("/api/analysis/position", { game_id: mate.id, ply: 0 });
assert.equal(mateAnalysis.source, "stockfish");
assert.deepEqual(mateAnalysis.score, { kind: "mate", value: 1 });
assert.ok(mateAnalysis.lines[0].san[0].endsWith("#"));

console.log("Container health, real Stockfish analysis, and mate-in-one checks passed.");
