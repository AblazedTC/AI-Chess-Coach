import assert from "node:assert/strict";
import { test } from "node:test";
import { analysisSchema, gameSchema, jobSchema, positionAt, readJson } from "./tests/contracts.ts";

const validGame = {
  id: "fixture-game",
  pgn: "1. e4 *",
  positions: [
    { ply: 0, fen: "start fen", position_key: "start" },
    { ply: 1, fen: "after e4 fen", position_key: "after-e4" },
  ],
  moves: [{ ply: 1, san: "e4", uci: "e2e4" }],
};

await test("game fixtures validate nested API data rather than asserting a TypeScript cast", () => {
  const game = gameSchema.parse(validGame);
  assert.equal(positionAt(game, 1).position_key, "after-e4");
  assert.throws(() => gameSchema.parse({ ...validGame, id: "" }));
  assert.throws(() => gameSchema.parse({ ...validGame, positions: [] }));
  assert.throws(() => gameSchema.parse({ ...validGame, positions: [{ ply: "0" }] }));
  assert.throws(() => gameSchema.parse({ ...validGame, moves: [{ uci: 42 }] }));
  assert.throws(() => positionAt(game, 99), /Missing fixture item/);
  const misordered = gameSchema.parse({
    ...validGame,
    positions: [{ ply: 1, fen: "fen", position_key: "wrong-ply" }],
  });
  assert.throws(() => positionAt(misordered, 0), /incorrect ply/);
});

await test("analysis and job fixtures reject malformed nested results", () => {
  const analysis = {
    game_id: "fixture-game",
    ply: 1,
    position_key: "after-e4",
    source: "demo",
    score: { kind: "cp", value: 0 },
    depth: null,
    classification: null,
    loss_cp: null,
  };
  assert.equal(analysisSchema.parse(analysis).score.value, 0);
  assert.throws(() => analysisSchema.parse({ ...analysis, score: { kind: "cp", value: NaN } }));
  assert.throws(() => analysisSchema.parse({ ...analysis, source: "invented-engine" }));
  const job = {
    id: "fixture-job",
    game_id: "fixture-game",
    status: "completed",
    total: 1,
    completed: 1,
    analyses: [analysis],
  };
  assert.equal(jobSchema.parse(job).analyses.length, 1);
  assert.throws(() => jobSchema.parse({ ...job, analyses: [{}] }));
  assert.throws(() => jobSchema.parse({ ...job, completed: -1 }));
});

await test("response JSON stays unknown until its runtime contract has been checked", async () => {
  const game = await readJson({ json: () => Promise.resolve(validGame) }, gameSchema);
  assert.equal(game.id, validGame.id);
  await assert.rejects(readJson({ json: () => Promise.resolve({}) }, gameSchema));
});
