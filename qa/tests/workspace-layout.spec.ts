import type { Locator, Page } from "@playwright/test";
import { test, expect, loadDemo, expectPosition } from "./fixtures";

async function bounds(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error("Expected a rendered workspace element");
  return box;
}

async function expectFitted(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        vertical: document.documentElement.scrollHeight <= window.innerHeight,
        horizontal: document.documentElement.scrollWidth <= window.innerWidth,
      })),
    )
    .toEqual({ vertical: true, horizontal: true });
}

async function expectStationary(locator: Locator, before: Awaited<ReturnType<typeof bounds>>) {
  const after = await bounds(locator);
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  expect(after.width).toBeCloseTo(before.width, 0);
  expect(after.height).toBeCloseTo(before.height, 0);
}

async function overflowWithTestContent(pane: Locator) {
  // Isolate scroll containment from demo response length and backend timing.
  await pane.evaluate((element) => {
    const content = document.createElement("div");
    content.textContent = "Deterministic overflow fixture";
    content.style.minHeight = "1800px";
    content.style.flexShrink = "0";
    element.append(content);
  });
  await expect
    .poll(() => pane.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
}

async function scrollPanel(page: Page, pane: Locator) {
  const box = await bounds(pane);
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 80));
  await page.mouse.wheel(0, 500);
  await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
}

for (const viewport of [
  { width: 1440, height: 900, layout: "three" },
  { width: 1280, height: 720, layout: "three" },
  { width: 1024, height: 768, layout: "wide" },
]) {
  test(`${viewport.width}x${viewport.height} contains Review and Coach scrolling without moving the board`, async ({
    page,
    api,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const game = await loadDemo(page, api);
    await expect(page.locator(".study-grid")).toHaveAttribute("data-layout", viewport.layout);
    const tabs = page.getByRole("tablist", { name: "Analysis tools", exact: true });
    await expect(tabs).toHaveClass(/tool-tabs/);
    await expect(tabs.getByRole("tab", { name: "Moves", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    for (const name of ["Moves", "Review", "Practice", "Insights"]) {
      await expect(tabs.getByRole("tab", { name, exact: true })).toBeVisible();
    }
    const board = page.getByRole("group", { name: "Chess board", exact: true });
    await expect(page.locator(".board-column")).toBeVisible();
    await expect(board).toBeInViewport({ ratio: 1 });
    await expectFitted(page);
    if (viewport.layout === "three") {
      await expect(page.locator(".coach-pane")).toBeVisible();
      await expect(page.locator(".coach-form")).toBeInViewport({ ratio: 1 });
    }

    await tabs.getByRole("tab", { name: "Review", exact: true }).click();
    const review = page.locator('[role="tabpanel"]:visible');
    await expect(review).toHaveCount(1);
    await expect(
      review.getByRole("region", { name: "Full-game analysis", exact: true }),
    ).toBeVisible();
    await overflowWithTestContent(review);
    const boardBefore = await bounds(board);
    const tabsBefore = await bounds(tabs);
    await scrollPanel(page, review);
    await expectStationary(board, boardBefore);
    await expectStationary(tabs, tabsBefore);
    await expectFitted(page);
    await expectPosition(page, game, 0);

    if (viewport.layout === "wide") {
      await tabs.getByRole("tab", { name: "Coach", exact: true }).click();
    }
    const coachScroll = page.locator(".coach-scroll");
    const composer = page.locator(".coach-form");
    await expect(coachScroll).toBeVisible();
    await overflowWithTestContent(coachScroll);
    const composerBefore = await bounds(composer);
    await scrollPanel(page, coachScroll);
    await expectStationary(composer, composerBefore);
    await expectStationary(board, boardBefore);
    await expectStationary(tabs, tabsBefore);
    await expect(composer).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "Ask coach", exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expectFitted(page);
  });
}

test("hidden Coach and Review remain mounted and retain a draft across tabs and breakpoints", async ({
  page,
  api,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const game = await loadDemo(page, api);
  const tabs = page.getByRole("tablist", { name: "Analysis tools", exact: true });
  await tabs.getByRole("tab", { name: "Review", exact: true }).click();
  const review = page.locator('[role="tabpanel"]:visible');
  await review.evaluate((element) => element.setAttribute("data-layout-test", "review"));
  const retainedReview = page.locator('[data-layout-test="review"]');
  await tabs.getByRole("tab", { name: "Coach", exact: true }).click();
  await expect(retainedReview).toBeAttached();
  await expect(retainedReview).toBeHidden();
  const question = page.getByLabel("Ask a question", { exact: true });
  await question.evaluate((element) => element.setAttribute("data-layout-test", "draft"));
  const retainedQuestion = page.locator('[data-layout-test="draft"]');
  const draft = "Keep this unsent question while I compare the analysis.";
  await question.fill(draft);
  for (const name of ["Moves", "Review", "Practice", "Insights"]) {
    await tabs.getByRole("tab", { name, exact: true }).click();
    await page
      .locator('[role="tabpanel"]:visible')
      .evaluate((element, tool) => element.setAttribute("data-mounted-tool", tool), name);
    await expect(retainedQuestion).toBeAttached();
    await expect(retainedQuestion).toBeHidden();
    await expect(retainedQuestion).toHaveValue(draft);
    await expect(retainedReview).toBeAttached();
  }
  await tabs.getByRole("tab", { name: "Coach", exact: true }).click();
  await expect(retainedQuestion).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator(".study-grid")).toHaveAttribute("data-layout", "narrow");
  await expect(retainedQuestion).toHaveValue(draft);
  const engine = tabs.getByRole("tab", { name: "Engine", exact: true });
  await engine.click();
  await expect(engine).toHaveAttribute("aria-selected", "true");
  await expect(
    page
      .locator('[role="tabpanel"]:visible')
      .getByRole("region", { name: "Position analysis", exact: true }),
  ).toBeVisible();
  await expect(retainedQuestion).toBeAttached();
  await expect(retainedQuestion).toBeHidden();
  await expect(retainedQuestion).toHaveValue(draft);
  await expect(retainedReview).toBeAttached();
  await tabs.getByRole("tab", { name: "Moves", exact: true }).click();
  await expect(retainedQuestion).toBeAttached();
  await expect(retainedQuestion).toBeHidden();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator(".study-grid")).toHaveAttribute("data-layout", "wide");
  await tabs.getByRole("tab", { name: "Coach", exact: true }).click();
  await expect(retainedQuestion).toBeVisible();
  await expect(retainedQuestion).toHaveValue(draft);
  await tabs.getByRole("tab", { name: "Moves", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".study-grid")).toHaveAttribute("data-layout", "three");
  await expect(retainedQuestion).toBeVisible();
  await expect(retainedQuestion).toHaveValue(draft);
  await expect(retainedReview).toBeAttached();
  for (const name of ["Moves", "Review", "Practice", "Insights"]) {
    const pane = page.locator(`[data-mounted-tool="${name}"]`);
    await expect(pane).toBeAttached();
    if (name !== "Moves") await expect(pane).toBeHidden();
  }
  await expectFitted(page);
  await expectPosition(page, game, 0);
});

test("tab keyboard navigation uses ArrowRight, Home and End without replay shortcuts", async ({
  page,
  api,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const game = await loadDemo(page, api);
  await page.getByRole("button", { name: "Next move", exact: true }).click();
  await expectPosition(page, game, 1);
  const tabs = page.getByRole("tablist", { name: "Analysis tools", exact: true });
  const moves = tabs.getByRole("tab", { name: "Moves", exact: true });
  const review = tabs.getByRole("tab", { name: "Review", exact: true });
  await moves.focus();
  await page.keyboard.press("ArrowRight");
  await expect(review).toBeFocused();
  await expectPosition(page, game, 1);
  await page.keyboard.press("End");
  await expect(tabs.getByRole("tab").last()).toBeFocused();
  await expectPosition(page, game, 1);
  await page.keyboard.press("Home");
  await expect(moves).toBeFocused();
  await expectPosition(page, game, 1);
  await page.getByRole("button", { name: "Next move", exact: true }).click();
  await expectPosition(page, game, 2);
});

test("360px keeps the board first, every tool reachable, and replay touch targets at least 44px", async ({
  page,
  api,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await loadDemo(page, api);
  await expect(page.locator(".study-grid")).toHaveAttribute("data-layout", "narrow");
  const board = page.getByRole("group", { name: "Chess board", exact: true });
  const tabs = page.getByRole("tablist", { name: "Analysis tools", exact: true });
  await expect(board).toBeInViewport();
  const boardBox = await bounds(board);
  expect(boardBox.y).toBeLessThan((await bounds(tabs)).y);
  expect(boardBox.x).toBeGreaterThanOrEqual(0);
  expect(boardBox.x + boardBox.width).toBeLessThanOrEqual(360);
  for (const name of [
    "First position",
    "Previous move",
    "Next move",
    "Last position",
    "Flip board",
  ]) {
    const box = await bounds(page.getByRole("button", { name, exact: true }));
    expect(box.width, `${name} width`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${name} height`).toBeGreaterThanOrEqual(44);
  }
  for (const name of ["Moves", "Engine", "Review", "Coach", "Practice", "Insights"]) {
    const tab = tabs.getByRole("tab", { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  }
});

test("1440x600 permits document scrolling and keeps the short-screen content reachable", async ({
  page,
  api,
}) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await loadDemo(page, api);
  await expect(page.locator(".study-grid")).toHaveAttribute("data-layout", "three");
  const tabs = page.getByRole("tablist", { name: "Analysis tools", exact: true });
  for (const name of ["Moves", "Review", "Practice", "Insights"]) {
    const tab = tabs.getByRole("tab", { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    const pane = page.locator('[role="tabpanel"]:visible');
    await pane.scrollIntoViewIfNeeded();
    await expect(pane).toBeInViewport();
  }
  for (const locator of [
    page.getByRole("button", { name: "Next move", exact: true }),
    page.getByRole("button", { name: "Flip board", exact: true }),
    page.getByLabel("Ask a question", { exact: true }),
    page.getByRole("button", { name: "Ask coach", exact: true }),
  ]) {
    await locator.scrollIntoViewIfNeeded();
    await expect(locator).toBeInViewport({ ratio: 1 });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
