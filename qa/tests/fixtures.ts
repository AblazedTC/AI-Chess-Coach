import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

export type Game = {
  id: string;
  pgn: string;
  positions: Array<{ ply: number; fen: string; position_key: string }>;
  moves: Array<{ ply: number; san: string; uci: string }>;
};

export const samplePgn = `[Event "Acceptance import"]
[White "Local White"]
[Black "Local Black"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 *`;

export const test = base.extend<{ api: APIRequestContext }>({
  api: async ({ playwright }, use) => {
    const api = await playwright.request.newContext({
      baseURL: "http://127.0.0.1:8100",
    });
    await use(api);
    await api.dispose();
  },
  page: async ({ page }, use) => {
    // A demo acceptance run must never silently depend on an external service.
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        ["data:", "blob:"].includes(url.protocol)
      ) {
        await route.continue();
      } else {
        await route.abort("blockedbyclient");
      }
    });
    await use(page);
  },
});

export async function demo(api: APIRequestContext): Promise<Game> {
  const response = await api.get("/api/demo");
  expect(response.ok()).toBeTruthy();
  const game = (await response.json()) as Game;
  expect(game.moves.length).toBeGreaterThanOrEqual(8);
  expect(game.positions.length).toBe(game.moves.length + 1);
  return game;
}

export async function loadDemo(page: Page, api: APIRequestContext) {
  const game = await demo(api);
  await page.goto("/");
  await page.getByRole("button", { name: "Try demo", exact: true }).click();
  await expectPosition(page, game, 0);
  return game;
}

export async function expectPosition(page: Page, game: Game, ply: number) {
  await expect(
    page.getByRole("group", { name: "Chess board", exact: true }),
  ).toHaveAttribute("data-fen", game.positions[ply].fen);
  await expect(page.getByText(`Position ${ply}`, { exact: true })).toBeVisible();
}

export { expect };
