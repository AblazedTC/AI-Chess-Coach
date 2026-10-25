import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { START_FEN } from "@/lib/chess";
import { AFTER_E4, analysis, coach, game, jsonResponse, practice } from "@/test/fixtures";
import { Workspace } from "./workspace";

let fetcher: ReturnType<typeof vi.fn<(input: string, init?: RequestInit) => Promise<Response>>>;

beforeEach(() => {
  fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path === "/api/health")
      return jsonResponse({ status: "ok", engine_mode: "demo", coach_mode: "deterministic" });
    if (path === "/api/demo") return jsonResponse(game);
    if (path === "/api/analysis/position")
      return jsonResponse({ ...analysis, ply: body.ply, position_key: `test-${body.ply}` });
    if (path === "/api/coach")
      return jsonResponse({ ...coach, ply: body.ply, position_key: `test-${body.ply}` });
    if (path === "/api/practice")
      return jsonResponse(
        body.moves.length
          ? { ...practice, fen: AFTER_E4, moves: body.moves, legal_moves: ["e7e5"] }
          : practice,
      );
    if (path === "/api/games/import")
      return jsonResponse(
        {
          error: { code: "invalid_pgn", message: "Please enter a valid PGN." },
          request_id: "test",
        },
        422,
      );
    if (path === "/api/insights")
      return jsonResponse({
        games_analyzed: 1,
        summary: "A material-only demo insight.",
        themes: [
          {
            name: "Balanced material",
            description: "Both sides start with equal material.",
            count: 1,
            supporting_positions: [{ game_id: game.id, ply: 1, position_key: "test-1" }],
          },
        ],
        limitations: ["Demo does not evaluate position quality."],
      });
    return jsonResponse({ error: { code: "not_found", message: "Not found." } }, 404);
  });
  vi.stubGlobal("fetch", fetcher);
});

afterEach(() => vi.unstubAllGlobals());

async function demo() {
  const user = userEvent.setup();
  render(<Workspace />);
  await user.click(screen.getByRole("button", { name: "Try demo" }));
  await screen.findByText("Position 0", { exact: true });
  return user;
}

describe("complete workspace", () => {
  it("opens the welcome and demo without external assets or configuration", async () => {
    await demo();
    expect(screen.getByRole("group", { name: "Chess board" })).toHaveAttribute(
      "data-fen",
      START_FEN,
    );
    expect(screen.getByRole("button", { name: "Previous move" })).toBeDisabled();
    expect(await screen.findByText("Material-only demo")).toBeInTheDocument();
    expect(screen.getByText(/It does not assess position quality/)).toBeInTheDocument();
  });
  it("navigates moves, uses scoped shortcuts, and flips without changing FEN", async () => {
    const user = await demo();
    const board = screen.getByRole("group", { name: "Chess board" });
    await user.click(screen.getByRole("button", { name: "Next move" }));
    expect(board).toHaveAttribute("data-fen", AFTER_E4);
    fireEvent.keyDown(screen.getByRole("button", { name: "Next move" }), { key: "ArrowLeft" });
    expect(await screen.findByText("Position 0", { exact: true })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Flip board" }));
    expect(board.firstElementChild).toHaveAttribute("aria-label", "h1, white rook");
    expect(board).toHaveAttribute("data-fen", START_FEN);
    fireEvent.keyDown(screen.getByLabelText("Ask a question"), { key: "ArrowRight" });
    expect(screen.getByText("Position 0", { exact: true })).toBeInTheDocument();
  });
  it("shows actionable import errors and preserves the current game", async () => {
    const user = await demo();
    await user.click(screen.getByRole("button", { name: "Import PGN" }));
    expect(screen.getByRole("dialog", { name: "Import PGN" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("PGN", { exact: true }), "not chess");
    await user.click(
      within(screen.getByRole("dialog", { name: "Import PGN" })).getByRole("button", {
        name: "Import PGN",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Please enter a valid PGN.");
    expect(screen.getByRole("group", { name: "Chess board" })).toHaveAttribute(
      "data-fen",
      START_FEN,
    );
  });
  it("keeps coach responses and history tied to the selected position", async () => {
    const user = await demo();
    await user.type(screen.getByLabelText("Ask a question"), "What should I focus on?");
    await user.click(screen.getByRole("button", { name: "Ask coach" }));
    const response = screen.getByRole("region", { name: "Coach response" });
    expect(await within(response).findByText(coach.message)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next move" }));
    expect(within(response).queryByText(coach.message)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous move" }));
    expect(within(response).getByText(coach.message)).toBeInTheDocument();
  });
  it("renders untrusted coach output as text, never HTML", async () => {
    fetcher.mockImplementationOnce(async () =>
      jsonResponse({ status: "ok", engine_mode: "demo", coach_mode: "deterministic" }),
    );
    const user = await demo();
    const defaultImplementation = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (input: string, init?: RequestInit) => {
      if (input.endsWith("/api/coach"))
        return jsonResponse({
          ...coach,
          message: '<script>alert("unsafe")</script><b>Plain text</b>',
        });
      return defaultImplementation(input, init);
    });
    await user.type(screen.getByLabelText("Ask a question"), "Explain");
    await user.click(screen.getByRole("button", { name: "Ask coach" }));
    expect(
      await screen.findByText('<script>alert("unsafe")</script><b>Plain text</b>'),
    ).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });
  it("plays and resets practice while leaving the original board unchanged", async () => {
    const user = await demo();
    await user.click(screen.getByRole("button", { name: "Practice" }));
    const practiceBoard = screen.getByRole("group", { name: "Practice board" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reset practice" })).toBeEnabled(),
    );
    await user.type(screen.getByLabelText("Practice move"), "e2e4");
    await user.click(screen.getByRole("button", { name: "Play move" }));
    await waitFor(() =>
      expect(screen.getByRole("group", { name: "Practice board" })).toHaveAttribute(
        "data-fen",
        AFTER_E4,
      ),
    );
    expect(screen.getByRole("group", { name: "Chess board" })).toHaveAttribute(
      "data-fen",
      START_FEN,
    );
    await user.click(screen.getByRole("button", { name: "Reset practice" }));
    await waitFor(() =>
      expect(screen.getByRole("group", { name: "Practice board" })).toHaveAttribute(
        "data-fen",
        START_FEN,
      ),
    );
    expect(practiceBoard).toHaveAttribute("data-fen", START_FEN);
  });
  it("rejects illegal practice locally and does not send an invalid variation", async () => {
    const user = await demo();
    await user.click(screen.getByRole("button", { name: "Practice" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reset practice" })).toBeEnabled(),
    );
    await user.type(screen.getByLabelText("Practice move"), "e2e5");
    await user.click(screen.getByRole("button", { name: "Play move" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not legal here");
    const requests = fetcher.mock.calls.filter(([url]) => String(url).endsWith("/api/practice"));
    expect(requests).toHaveLength(1);
  });
  it("shows grounded insights and follows supporting position citations", async () => {
    const user = await demo();
    await user.click(screen.getByRole("button", { name: "Insights" }));
    const region = screen.getByRole("region", { name: "Insights" });
    expect(await within(region).findByText("A material-only demo insight.")).toBeInTheDocument();
    expect(within(region).getByText("Balanced material")).toBeInTheDocument();
    await user.click(within(region).getByRole("button", { name: "Position 1" }));
    expect(screen.getByRole("group", { name: "Chess board" })).toHaveAttribute(
      "data-fen",
      AFTER_E4,
    );
  });
  it("exposes the coach API character limit in the field and validation", async () => {
    const user = await demo();
    const input = screen.getByLabelText("Ask a question");
    expect(input).toHaveAttribute("maxlength", "2000");
    fireEvent.change(input, { target: { value: "x".repeat(2001) } });
    await user.click(screen.getByRole("button", { name: "Ask coach" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("2,000 characters or fewer");
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/api/coach"))).toBe(false);
  });
  it("disables capped practice interaction but leaves reset available", async () => {
    const user = await demo();
    const original = fetcher.getMockImplementation()!;
    let initialization = 0;
    fetcher.mockImplementation(async (input, init) => {
      if (input.endsWith("/api/practice")) {
        initialization++;
        return jsonResponse(
          initialization === 1
            ? { ...practice, moves: Array.from({ length: 100 }, () => "g1f3") }
            : practice,
        );
      }
      return original(input, init);
    });
    await user.click(screen.getByRole("button", { name: "Practice" }));
    expect(await screen.findByText(/This variation has reached 100 moves/)).toBeInTheDocument();
    expect(screen.getByLabelText("Practice move")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Play move" })).toBeDisabled();
    expect(
      within(screen.getByRole("group", { name: "Practice board" })).getByRole("button", {
        name: "e2, white pawn",
      }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset practice" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Reset practice" }));
    await waitFor(() => expect(screen.getByLabelText("Practice move")).toBeEnabled());
  });
  it("explains the insights selection cap and disables only unchecked games at ten", async () => {
    const user = userEvent.setup();
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (input, init) => {
      if (input.endsWith("/api/players/test-player"))
        return jsonResponse({ username: "test-player", name: null, rating: null, avatar: null });
      if (input.endsWith("/api/players/test-player/games"))
        return jsonResponse({
          games: Array.from({ length: 12 }, (_, index) => ({
            id: `game-${index}`,
            white: `White${index}`,
            black: "Black",
            result: "*",
            end_time: null,
            time_control: null,
            url: null,
          })),
        });
      return original(input, init);
    });
    render(<Workspace />);
    await user.type(screen.getByLabelText("Chess.com username"), "test-player");
    await user.click(screen.getByRole("button", { name: "Search games" }));
    const boxes = await screen.findAllByRole("checkbox");
    for (const box of boxes.slice(0, 10)) await user.click(box);
    expect(screen.getByText(/10 \/ 10 games selected.*Limit reached/)).toBeInTheDocument();
    expect(boxes[9]).toBeEnabled();
    expect(boxes[10]).toBeDisabled();
    expect(boxes[11]).toBeDisabled();
    await user.click(boxes[0]);
    expect(boxes[10]).toBeEnabled();
  });
});
