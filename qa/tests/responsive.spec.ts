import AxeBuilder from "@axe-core/playwright";
import { test, expect, loadDemo, expectPosition } from "./fixtures";

test("390px viewport fits the board, forms, and practice without horizontal overflow", async ({
  page,
  api,
}) => {
  const game = await loadDemo(page, api);
  const expectNoOverflow = async () => {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  };
  await expectNoOverflow();
  const board = page.getByRole("group", { name: "Chess board", exact: true });
  const bounds = await board.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Next move", exact: true }).tap();
  await expectPosition(page, game, 1);
  await page.getByRole("button", { name: "Practice", exact: true }).tap();
  await expect(
    page.getByRole("group", { name: "Practice board", exact: true }),
  ).toBeVisible();
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
