import AxeBuilder from "@axe-core/playwright";
import { test, expect, loadDemo, expectPosition, samplePgn } from "./fixtures";

test("offline demo navigation keeps board FEN and move position consistent", async ({
  page,
  api,
}) => {
  const game = await loadDemo(page, api);
  await expect(
    page.getByRole("button", { name: "Previous move", exact: true }),
  ).toBeDisabled();
  for (let ply = 1; ply <= 3; ply += 1) {
    await page.getByRole("button", { name: "Next move", exact: true }).click();
    await expectPosition(page, game, ply);
  }
  await page.getByRole("button", { name: "Previous move", exact: true }).click();
  await expectPosition(page, game, 2);
});

test("flipping the board preserves the selected position", async ({ page, api }) => {
  const game = await loadDemo(page, api);
  await page.getByRole("button", { name: "Next move", exact: true }).click();
  const board = page.getByRole("group", { name: "Chess board", exact: true });
  const before = await board.innerHTML();
  await page.getByRole("button", { name: "Flip board", exact: true }).click();
  await expectPosition(page, game, 1);
  await expect.poll(() => board.innerHTML()).not.toBe(before);
  await page.getByRole("button", { name: "Flip board", exact: true }).click();
  await expect(board).toHaveJSProperty("innerHTML", before);
});

test("custom PGN import renders the imported game rather than the demo", async ({
  page,
  api,
}) => {
  const imported = await api.post("/api/games/import", {
    data: { pgn: samplePgn },
  });
  expect(imported.ok()).toBeTruthy();
  const game = await imported.json();
  await page.goto("/");
  await page.getByLabel("PGN", { exact: true }).fill(samplePgn);
  await page.getByRole("button", { name: "Import PGN", exact: true }).click();
  await expectPosition(page, game, 0);
  await page.getByRole("button", { name: "Next move", exact: true }).click();
  await expectPosition(page, game, 1);
  expect(game.moves[0].uci).toBe("d2d4");
});

test("invalid PGN shows an accessible error and preserves the loaded board", async ({
  page,
  api,
}) => {
  const game = await loadDemo(page, api);
  await page.getByLabel("PGN", { exact: true }).fill("not a legal chess game");
  await page.getByRole("button", { name: "Import PGN", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/pgn|invalid|moves/i);
  await expectPosition(page, game, 0);
});

test("coach renders the response grounded in the selected game and position", async ({
  page,
  api,
}) => {
  const game = await loadDemo(page, api);
  await page.getByRole("button", { name: "Next move", exact: true }).click();
  await page.getByLabel("Ask a question", { exact: true }).fill(
    "What is the material balance in this position?",
  );
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/coach" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Ask coach", exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const coach = await response.json();
  expect(coach.game_id).toBe(game.id);
  expect(coach.ply).toBe(1);
  expect(coach.position_key).toBe(game.positions[1].position_key);
  expect(coach.mode).toBe("deterministic");
  expect(coach.message.length).toBeGreaterThan(20);
  expect(coach.citations.length).toBeGreaterThan(0);
  const region = page.getByRole("region", { name: "Coach response", exact: true });
  await expect(region).toContainText(coach.message);
  await expectPosition(page, game, 1);
});

test("practice is isolated from game history and resets to the selected position", async ({
  page,
  api,
}) => {
  const game = await loadDemo(page, api);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  const board = page.getByRole("group", { name: "Practice board", exact: true });
  await expect(board).toHaveAttribute("data-fen", game.positions[0].fen);
  const practice = await api.post("/api/practice", {
    data: { game_id: game.id, ply: 0, moves: ["e2e4"] },
  });
  expect(practice.ok()).toBeTruthy();
  const expected = await practice.json();
  await page.getByLabel("Practice move", { exact: true }).fill("e2e4");
  await page.getByRole("button", { name: "Play move", exact: true }).click();
  await expect(board).toHaveAttribute("data-fen", expected.fen);
  expect(expected.fen).not.toBe(game.positions[0].fen);
  await expectPosition(page, game, 0);
  await page.getByRole("button", { name: "Reset practice", exact: true }).click();
  await expect(board).toHaveAttribute("data-fen", game.positions[0].fen);
});

test("full-game analysis reaches completion with every position analyzed", async ({
  page,
  api,
}) => {
  const game = await loadDemo(page, api);
  const jobPromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/analysis/jobs" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Analyze game", exact: true }).click();
  const response = await jobPromise;
  expect(response.ok()).toBeTruthy();
  const job = await response.json();
  await expect
    .poll(async () => {
      const response = await api.get(`/api/analysis/jobs/${job.id}`);
      expect(response.ok()).toBeTruthy();
      return (await response.json()).status;
    })
    .toBe("completed");
  const completed = await (await api.get(`/api/analysis/jobs/${job.id}`)).json();
  expect(completed.game_id).toBe(game.id);
  expect(completed.completed).toBe(completed.total);
  expect(completed.total).toBeGreaterThanOrEqual(game.moves.length);
  expect(completed.analyses).toHaveLength(completed.total);
  const region = page.getByRole("region", {
    name: "Full-game analysis",
    exact: true,
  });
  await expect(region).toContainText(/completed/i);
  await expectPosition(page, game, 0);
});

test("insights displays supported themes and honest demo limitations", async ({
  page,
  api,
}) => {
  const game = await loadDemo(page, api);
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/insights" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Insights", exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const insights = await response.json();
  expect(insights.games_analyzed).toBe(1);
  expect(insights.summary.length).toBeGreaterThan(0);
  expect(insights.limitations.length).toBeGreaterThan(0);
  const region = page.getByRole("region", { name: "Insights", exact: true });
  await expect(region).toContainText(insights.summary);
  for (const theme of insights.themes) {
    await expect(region).toContainText(theme.name);
    expect(theme.supporting_positions.length).toBeGreaterThan(0);
    for (const support of theme.supporting_positions) {
      expect(support.game_id).toBe(game.id);
      expect(support.position_key).toBe(game.positions[support.ply].position_key);
    }
  }
  await expect(region).toContainText(/demo|material|limited|deterministic/i);
});

test("keyboard navigation works without hijacking typing in form fields", async ({
  page,
  api,
}) => {
  const game = await loadDemo(page, api);
  await page.getByRole("button", { name: "Next move", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expectPosition(page, game, 1);
  await page.keyboard.press("ArrowLeft");
  await expectPosition(page, game, 0);
  for (const label of ["PGN", "Ask a question"]) {
    const field = page.getByLabel(label, { exact: true });
    await field.fill("typed text");
    await field.press("ArrowRight");
    await field.press("ArrowLeft");
    await field.press("Home");
    await field.press("End");
    await expect(field).toHaveValue("typed text");
    await expectPosition(page, game, 0);
  }
  await page.getByRole("button", { name: "Next move", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expectPosition(page, game, 1);
});

test("loaded demo has no serious or critical accessibility violations", async ({
  page,
  api,
}) => {
  await loadDemo(page, api);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});
