import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GameBoard } from "./game-board";
import { initialState } from "@/lib/state";
import { game } from "@/test/fixtures";

describe("FEN-aware move list", () => {
  it("puts a black-start move in the Black column with the FEN fullmove number", () => {
    const custom = {
      ...game,
      positions: [
        { ...game.positions[0], fen: "4k3/8/8/8/8/8/8/4K3 b - - 0 8", turn: "black" as const },
        game.positions[1],
      ],
      moves: [
        { ...game.moves[0], san: "e5" },
        { ...game.moves[1], san: "Nf3" },
      ],
    };
    render(
      <GameBoard
        model={{
          state: { ...initialState, game: custom },
          position: custom.positions[0],
          navigate: vi.fn(),
          flip: vi.fn(),
        }}
      />,
    );
    const eighth = screen.getByRole("group", { name: "Move 8" });
    expect(eighth.children[1]).toHaveAccessibleName("No White move");
    expect(eighth.children[2]).toHaveAccessibleName("Go to move 1: e5");
    expect(
      within(screen.getByRole("group", { name: "Move 9" })).getByRole("button", {
        name: "Go to move 2: Nf3",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Move 1" })).not.toBeInTheDocument();
  });
  it("starts a later White position on its actual fullmove number", () => {
    const custom = {
      ...game,
      positions: [
        { ...game.positions[0], fen: "4k3/8/8/8/8/8/8/4K3 w - - 0 17" },
        game.positions[1],
      ],
    };
    render(
      <GameBoard
        model={{
          state: { ...initialState, game: custom },
          position: custom.positions[0],
          navigate: vi.fn(),
          flip: vi.fn(),
        }}
      />,
    );
    const row = screen.getByRole("group", { name: "Move 17" });
    expect(row.children[1]).toHaveAccessibleName("Go to move 1: e4");
    expect(row.children[2]).toHaveAccessibleName("Go to move 2: e5");
  });
});
