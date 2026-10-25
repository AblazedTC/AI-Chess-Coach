import type { APIResponse } from "@playwright/test";
import { test, expect, demo, samplePgn } from "./fixtures";

async function expectError(response: APIResponse, statuses: number[]) {
  expect(statuses).toContain(response.status());
  const body = await response.json();
  expect(body).toMatchObject({
    error: {
      code: expect.any(String),
      message: expect.any(String),
    },
    request_id: expect.any(String),
  });
  expect(body.error.code.length).toBeGreaterThan(0);
  expect(body.error.message.length).toBeGreaterThan(0);
  expect(body.request_id.length).toBeGreaterThan(0);
  expect(JSON.stringify(body)).not.toMatch(/Traceback|File ".*\.py"/);
}

test("health reports offline demo and deterministic coach modes", async ({ api }) => {
  const response = await api.get("/api/health");
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({
    status: "ok",
    engine_mode: "demo",
    coach_mode: "deterministic",
  });
  const game = await demo(api);
  expect(game.positions[0].ply).toBe(0);
  expect(game.positions[0].fen).toMatch(/ w /);
  expect(new Set(game.positions.map((position) => position.position_key)).size)
    .toBeGreaterThan(1);
});

test("invalid request bodies and unknown IDs use the public error envelope", async ({
  api,
}) => {
  for (const path of [
    "/api/games/import",
    "/api/analysis/position",
    "/api/analysis/jobs",
    "/api/coach",
    "/api/practice",
    "/api/insights",
  ]) {
    await expectError(await api.post(path, { data: {} }), [400, 422]);
  }
  await expectError(
    await api.post("/api/games/import", {
      data: { pgn: "not a legal chess game" },
    }),
    [400, 422],
  );
  await expectError(await api.get("/api/games/nonexistent-acceptance-id"), [404]);
  await expectError(await api.get("/api/analysis/jobs/nonexistent-acceptance-id"), [
    404,
  ]);
  const game = await demo(api);
  await expectError(
    await api.post("/api/analysis/position", {
      data: { game_id: game.id, ply: 999999 },
    }),
    [400, 404, 422],
  );
});

test("imports have stable IDs and cross-game analysis never leaks position identity", async ({
  api,
}) => {
  const original = await demo(api);
  const response = await api.post("/api/games/import", {
    data: { pgn: samplePgn },
  });
  expect(response.ok()).toBeTruthy();
  const imported = await response.json();
  const repeat = await api.post("/api/games/import", {
    data: { pgn: samplePgn },
  });
  expect(repeat.ok()).toBeTruthy();
  expect((await repeat.json()).id).toBe(imported.id);
  expect(imported.id).not.toBe(original.id);
  expect(imported.positions[1].fen).not.toBe(original.positions[1].fen);
  for (const game of [imported, original, imported]) {
    const detail = await api.get(`/api/games/${game.id}`);
    expect(detail.ok()).toBeTruthy();
    expect(await detail.json()).toEqual(game);
    const response = await api.post("/api/analysis/position", {
      data: { game_id: game.id, ply: 1 },
    });
    expect(response.ok()).toBeTruthy();
    const analysis = await response.json();
    expect(analysis).toMatchObject({
      game_id: game.id,
      ply: 1,
      position_key: game.positions[1].position_key,
      source: "demo",
    });
    const coachResponse = await api.post("/api/coach", {
      data: { game_id: game.id, ply: 1, question: "Explain the material." },
    });
    expect(coachResponse.ok()).toBeTruthy();
    expect(await coachResponse.json()).toMatchObject({
      game_id: game.id,
      ply: 1,
      position_key: game.positions[1].position_key,
      mode: "deterministic",
    });
  }
});

test("demo analysis is reproducible and honestly material-only", async ({ api }) => {
  const response = await api.post("/api/games/import", {
    data: {
      pgn: `[Event "Material test"]
[White "White"]
[Black "Black"]
[Result "*"]

1. e4 d5 2. exd5 Qxd5 *`,
    },
  });
  expect(response.ok()).toBeTruthy();
  const game = await response.json();
  const scores: number[] = [];
  for (const ply of [0, 1, 2, 3, 4]) {
    const response = await api.post("/api/analysis/position", {
      data: { game_id: game.id, ply },
    });
    expect(response.ok()).toBeTruthy();
    const analysis = await response.json();
    expect(analysis).toMatchObject({
      game_id: game.id,
      ply,
      position_key: game.positions[ply].position_key,
      source: "demo",
      score: { kind: "cp", value: expect.any(Number) },
    });
    expect(Number.isFinite(analysis.score.value)).toBe(true);
    expect(analysis.depth).toBeNull();
    expect(analysis.classification).toBeNull();
    expect(analysis.loss_cp).toBeNull();
    scores.push(analysis.score.value);
    const again = await api.post("/api/analysis/position", {
      data: { game_id: game.id, ply },
    });
    expect(again.ok()).toBeTruthy();
    expect(await again.json()).toEqual(analysis);
  }
  expect(scores.slice(0, 3)).toEqual([0, 0, 0]);
  expect(scores[3]).toBe(100);
  expect(scores[4]).toBe(0);
});

test("practice rejects illegal moves and never mutates the stored game", async ({
  api,
}) => {
  const game = await demo(api);
  await expectError(
    await api.post("/api/practice", {
      data: { game_id: game.id, ply: 0, moves: ["e2e5"] },
    }),
    [400, 422],
  );
  const response = await api.post("/api/practice", {
    data: { game_id: game.id, ply: 0, moves: ["e2e4", "e7e5"] },
  });
  expect(response.ok()).toBeTruthy();
  const practice = await response.json();
  expect(practice.moves).toEqual(["e2e4", "e7e5"]);
  expect(practice.fen).toMatch(
    /^rnbqkbnr\/pppp1ppp\/8\/4p3\/4P3\/8\/PPPP1PPP\/RNBQKBNR w /,
  );
  expect(practice.position_key).not.toBe(game.positions[0].position_key);
  expect(practice.legal_moves).toContain("g1f3");
  expect(practice.is_game_over).toBe(false);
  const resetResponse = await api.post("/api/practice", {
    data: { game_id: game.id, ply: 0, moves: [] },
  });
  expect(resetResponse.ok()).toBeTruthy();
  expect(await resetResponse.json()).toMatchObject({
    fen: game.positions[0].fen,
    position_key: game.positions[0].position_key,
    moves: [],
  });
  const detail = await api.get(`/api/games/${game.id}`);
  expect(detail.ok()).toBeTruthy();
  expect(await detail.json()).toEqual(game);
});

test("analysis jobs complete with stable position references and support cancellation", async ({
  api,
}) => {
  const game = await demo(api);
  const create = await api.post("/api/analysis/jobs", { data: { game_id: game.id } });
  expect(create.ok()).toBeTruthy();
  const job = await create.json();
  await expect
    .poll(async () => {
      const response = await api.get(`/api/analysis/jobs/${job.id}`);
      expect(response.ok()).toBeTruthy();
      const current = await response.json();
      expect(current.game_id).toBe(game.id);
      expect(current.completed).toBeLessThanOrEqual(current.total);
      expect(current.status).not.toBe("failed");
      return current.status;
    })
    .toBe("completed");
  const completed = await (await api.get(`/api/analysis/jobs/${job.id}`)).json();
  expect(completed.completed).toBe(completed.total);
  expect(completed.total).toBeGreaterThanOrEqual(game.moves.length);
  expect(completed.analyses).toHaveLength(completed.total);
  expect(new Set(completed.analyses.map((item: { ply: number }) => item.ply)).size)
    .toBe(completed.total);
  for (const analysis of completed.analyses) {
    expect(analysis.game_id).toBe(game.id);
    expect(analysis.position_key).toBe(game.positions[analysis.ply].position_key);
  }
  const second = await api.post("/api/analysis/jobs", { data: { game_id: game.id } });
  expect(second.ok()).toBeTruthy();
  const secondJob = await second.json();
  const cancel = await api.delete(`/api/analysis/jobs/${secondJob.id}`);
  expect(cancel.ok()).toBeTruthy();
  const terminal = await cancel.json();
  // A tiny demo job may legitimately finish before cancellation reaches it.
  expect(["cancelled", "completed"]).toContain(terminal.status);
  const final = await (await api.get(`/api/analysis/jobs/${secondJob.id}`)).json();
  expect(final.status).toBe(terminal.status);
  expect(final.completed).toBe(terminal.completed);
});

test("coach and insights cite only positions from the requested game", async ({
  api,
}) => {
  const game = await demo(api);
  const response = await api.post("/api/coach", {
    data: {
      game_id: game.id,
      ply: 2,
      question: "What is the material balance?",
      history: [],
    },
  });
  expect(response.ok()).toBeTruthy();
  const coach = await response.json();
  expect(coach).toMatchObject({
    game_id: game.id,
    ply: 2,
    position_key: game.positions[2].position_key,
    mode: "deterministic",
  });
  expect(coach.message).toMatch(/material|pawn|piece|bishop|knight|rook|queen/i);
  expect(coach.citations.length).toBeGreaterThan(0);
  expect(coach.citations.every((citation: unknown) => typeof citation === "string"))
    .toBe(true);
  const practice = await api.post("/api/practice", {
    data: { game_id: game.id, ply: 2, moves: [] },
  });
  expect(practice.ok()).toBeTruthy();
  const legal = (await practice.json()).legal_moves;
  for (const move of coach.suggested_moves) {
    expect(legal).toContain(move.uci);
    expect(move.san.length).toBeGreaterThan(0);
    expect(move.engine_verified).toBe(false);
  }
  const insightsResponse = await api.post("/api/insights", {
    data: { game_ids: [game.id] },
  });
  expect(insightsResponse.ok()).toBeTruthy();
  const insights = await insightsResponse.json();
  expect(insights.games_analyzed).toBe(1);
  expect(insights.summary.length).toBeGreaterThan(0);
  expect(insights.limitations.length).toBeGreaterThan(0);
  expect(insights.themes.length).toBeGreaterThan(0);
  for (const theme of insights.themes) {
    expect(theme.count).toBeGreaterThan(0);
    expect(theme.supporting_positions.length).toBeGreaterThan(0);
    for (const support of theme.supporting_positions) {
      expect(support.game_id).toBe(game.id);
      expect(support.position_key).toBe(game.positions[support.ply].position_key);
    }
  }
});
