import AxeBuilder from "@axe-core/playwright";
import { test, expect, loadDemo, expectPosition, samplePgn } from "./fixtures";
import {
  at,
  coachSchema,
  gameSchema,
  insightsSchema,
  jobSchema,
  positionAt,
  practiceSchema,
  readJson,
} from "./contracts";

test("default SVG pieces render in preview, replay, flipped boards, and practice", async ({
  page,
  api,
}) => {
  await page.goto("/");
  const preview = page.locator(".welcome-board .chess-board");
  await expect(preview.locator(".piece svg").first()).toBeVisible();
  const game = await loadDemo(page, api);
  const board = page.getByRole("group", { name: "Chess board", exact: true });
  await expect(board.locator(".piece svg")).toHaveCount(32);
  const avatars = page.locator(".player-avatar .piece");
  await expect(avatars.first()).toHaveAttribute("data-piece", "bK");
  await expect(avatars.last()).toHaveAttribute("data-piece", "wK");
  for (const piece of ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"]) {
    const svg = board.locator(`[data-piece="${piece}"] svg`).first();
    await expect(svg).toBeVisible();
    const bounds = await svg.boundingBox();
    if (!bounds) throw new Error(`SVG piece ${piece} has no bounds`);
    expect(bounds.width).toBeGreaterThan(24);
    expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(1);
  }
  await page.getByRole("button", { name: "Flip board", exact: true }).click();
  await expect(board.locator(".square").first().locator(".piece")).toHaveAttribute(
    "data-piece",
    "wR",
  );
  await expectPosition(page, game, 0);
  await expect(avatars.first()).toHaveAttribute("data-piece", "wK");
  await expect(avatars.last()).toHaveAttribute("data-piece", "bK");
  await page.getByRole("tab", { name: "Practice", exact: true }).click();
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  const practiceBoard = page.getByRole("group", { name: "Practice board", exact: true });
  await expect(practiceBoard.locator(".piece svg")).toHaveCount(32);
  await expect(practiceBoard.getByRole("button", { name: "e2, white pawn" })).toBeEnabled();
  await practiceBoard.getByRole("button", { name: "e2, white pawn" }).click();
  await practiceBoard.getByRole("button", { name: "e4, empty" }).click();
  await expect(
    practiceBoard.getByRole("button", { name: "e4, white pawn" }).locator(".piece"),
  ).toHaveAttribute("data-piece", "wP");
  await expectPosition(page, game, 0);
});

test("offline demo navigation keeps board FEN and move position consistent", async ({
  page,
  api,
}) => {
  const game = await loadDemo(page, api);
  await expect(page.getByRole("button", { name: "Previous move", exact: true })).toBeDisabled();
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

test("custom PGN import renders the imported game rather than the demo", async ({ page, api }) => {
  const imported = await api.post("/api/games/import", {
    data: { pgn: samplePgn },
  });
  expect(imported.ok()).toBeTruthy();
  const game = await readJson(imported, gameSchema);
  await page.goto("/");
  await page.getByRole("button", { name: "Import PGN", exact: true }).click();
  await page.getByLabel("PGN", { exact: true }).fill(samplePgn);
  await page.getByRole("dialog").getByRole("button", { name: "Import PGN", exact: true }).click();
  await expectPosition(page, game, 0);
  await page.getByRole("button", { name: "Next move", exact: true }).click();
  await expectPosition(page, game, 1);
  expect(at(game.moves, 0).uci).toBe("d2d4");
});

test("invalid PGN shows an accessible error and preserves the loaded board", async ({
  page,
  api,
}) => {
  const game = await loadDemo(page, api);
  await page.getByRole("button", { name: "Import PGN", exact: true }).click();
  await page.getByLabel("PGN", { exact: true }).fill("not a legal chess game");
  await page.getByRole("dialog").getByRole("button", { name: "Import PGN", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(/pgn|invalid|moves/i);
  await page.getByLabel("PGN", { exact: true }).press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expectPosition(page, game, 0);
});

test("coach renders the response grounded in the selected game and position", async ({
  page,
  api,
}) => {
  const game = await loadDemo(page, api);
  await page.getByRole("button", { name: "Next move", exact: true }).click();
  await page
    .getByLabel("Ask a question", { exact: true })
    .fill("What is the material balance in this position?");
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/coach" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Ask coach", exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const coach = await readJson(response, coachSchema);
  expect(coach.game_id).toBe(game.id);
  expect(coach.ply).toBe(1);
  expect(coach.position_key).toBe(positionAt(game, 1).position_key);
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
  await page.getByRole("tab", { name: "Practice", exact: true }).click();
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  const board = page.getByRole("group", { name: "Practice board", exact: true });
  await expect(board).toHaveAttribute("data-fen", positionAt(game, 0).fen);
  const practice = await api.post("/api/practice", {
    data: { game_id: game.id, ply: 0, moves: ["e2e4"] },
  });
  expect(practice.ok()).toBeTruthy();
  const expected = await readJson(practice, practiceSchema);
  await page.getByLabel("Practice move", { exact: true }).fill("e2e4");
  await page.getByRole("button", { name: "Play move", exact: true }).click();
  await expect(board).toHaveAttribute("data-fen", expected.fen);
  expect(expected.fen).not.toBe(positionAt(game, 0).fen);
  await expectPosition(page, game, 0);
  await page.getByRole("button", { name: "Reset practice", exact: true }).click();
  await expect(board).toHaveAttribute("data-fen", positionAt(game, 0).fen);
});

test("full-game analysis reaches completion with every position analyzed", async ({
  page,
  api,
}) => {
  const game = await loadDemo(page, api);
  await page.getByRole("tab", { name: "Review", exact: true }).click();
  const jobPromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/analysis/jobs" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Analyze game", exact: true }).click();
  const response = await jobPromise;
  expect(response.ok()).toBeTruthy();
  const job = await readJson(response, jobSchema);
  await expect
    .poll(async () => {
      const response = await api.get(`/api/analysis/jobs/${job.id}`);
      expect(response.ok()).toBeTruthy();
      return (await readJson(response, jobSchema)).status;
    })
    .toBe("completed");
  const completed = await readJson(await api.get(`/api/analysis/jobs/${job.id}`), jobSchema);
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

test("insights displays supported themes and honest demo limitations", async ({ page, api }) => {
  const game = await loadDemo(page, api);
  await page.getByRole("tab", { name: "Insights", exact: true }).click();
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/insights" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Insights", exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const insights = await readJson(response, insightsSchema);
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
      expect(support.position_key).toBe(positionAt(game, support.ply).position_key);
    }
  }
  await expect(region).toContainText(/demo|material|limited|deterministic/i);
});

test("keyboard navigation works without hijacking typing in form fields", async ({ page, api }) => {
  const game = await loadDemo(page, api);
  await page.getByRole("button", { name: "Next move", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expectPosition(page, game, 1);
  await page.keyboard.press("ArrowLeft");
  await expectPosition(page, game, 0);
  for (const label of ["Ask a question", "PGN"]) {
    if (label === "PGN") {
      await page.getByRole("button", { name: "Import PGN", exact: true }).click();
    }
    const field = page.getByLabel(label, { exact: true });
    await field.fill("typed text");
    await field.press("ArrowRight");
    await field.press("ArrowLeft");
    await field.press("Home");
    await field.press("End");
    await expect(field).toHaveValue("typed text");
    if (label === "PGN") {
      await field.press("Escape");
      await expect(page.getByRole("dialog")).not.toBeVisible();
    }
    await expectPosition(page, game, 0);
  }
  await page.getByRole("button", { name: "Next move", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expectPosition(page, game, 1);
});

for (const width of [1280, 390]) {
  test(`${width}px sidebar navigation focuses the visible tool after rendering`, async ({
    page,
    api,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const game = await loadDemo(page, api);
    const library = page.getByRole("complementary", { name: "Game library", exact: true });
    const insights = page.getByRole("tabpanel", { name: "Insights", exact: true });
    const openLibrary = async () => {
      if (width < 1024)
        await library.getByRole("button", { name: "Game library", exact: true }).click();
    };
    for (let visit = 0; visit < 2; visit++) {
      await openLibrary();
      await library.getByRole("link", { name: "Insights", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(insights).toBeVisible();
      await expect(insights).toBeFocused();
      await expect(page.getByRole("tab", { name: "Insights", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }
    await openLibrary();
    await library.getByRole("link", { name: "Game review", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    await expect(page.getByRole("tab", { name: "Moves", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expectPosition(page, game, 0);
  });
}

test("loaded demo has no serious or critical accessibility violations", async ({ page, api }) => {
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
