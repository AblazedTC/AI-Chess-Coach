import AxeBuilder from "@axe-core/playwright";
import { test, expect, loadDemo, expectPosition } from "./fixtures";
import { gameSchema, readJson } from "./contracts";

test("390px viewport fits the board, forms, and practice without horizontal overflow", async ({
  page,
  api,
}) => {
  const game = await loadDemo(page, api);
  const expectNoOverflow = async () => {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  };
  await expectNoOverflow();
  const board = page.getByRole("group", { name: "Chess board", exact: true });
  const bounds = await board.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error("Chess board has no bounding box");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Next move", exact: true }).tap();
  await expectPosition(page, game, 1);
  await page.getByRole("button", { name: "Practice", exact: true }).tap();
  await expect(page.getByRole("group", { name: "Practice board", exact: true })).toBeVisible();
  await expectNoOverflow();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

test("long evaluation graph scrolls within 390px and keeps its last position reachable", async ({
  page,
  api,
}) => {
  const moves = Array.from(
    { length: 40 },
    (_, index) => `${index + 1}. ${index % 2 === 0 ? "Nf3 Nf6" : "Ng1 Ng8"}`,
  ).join(" ");
  const pgn = `[Event "Long mobile graph"]\n[Result "*"]\n\n${moves} *`;
  const response = await api.post("/api/games/import", { data: { pgn } });
  expect(response.ok()).toBeTruthy();
  const game = await readJson(response, gameSchema);
  expect(game.moves).toHaveLength(80);
  await page.goto("/");
  await page.getByRole("button", { name: "Import PGN", exact: true }).click();
  await page.getByLabel("PGN", { exact: true }).fill(pgn);
  await page.getByRole("dialog").getByRole("button", { name: "Import PGN", exact: true }).click();
  await expectPosition(page, game, 0);
  await page.getByRole("button", { name: "Analyze game", exact: true }).click();
  await expect(page.getByRole("region", { name: "Full-game analysis", exact: true })).toContainText(
    /completed/i,
  );
  const graph = page.getByRole("region", { name: "Demo material balance graph", exact: true });
  await expect(graph).toBeVisible();
  await expect
    .poll(() => graph.evaluate((element) => element.scrollWidth > element.clientWidth))
    .toBe(true);
  const lastPosition = graph.getByRole("button", { name: /^Position 80, material / });
  await lastPosition.scrollIntoViewIfNeeded();
  await lastPosition.click();
  await expectPosition(page, game, 80);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
