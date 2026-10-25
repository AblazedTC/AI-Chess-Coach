import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GameBoard, MoveList } from "./game-board";
import { initialState } from "@/lib/state";
import { analysis, game } from "@/test/fixtures";

describe("board evaluation", () => {
  it("labels demo material honestly and preserves White's score when flipped", () => {
    const model = {
      state: { ...initialState, game },
      position: game.positions[0],
      navigate: vi.fn(),
      flip: vi.fn(),
      analysis: { ...analysis, score: { kind: "cp" as const, value: 200 } },
    };
    const { rerender } = render(<GameBoard model={model} />);
    const bar = screen.getByRole("img", {
      name: "Material balance: +2.00, White's perspective",
    });
    expect(bar.firstElementChild).toHaveStyle("--white-share: 60%");
    rerender(<GameBoard model={{ ...model, state: { ...model.state, flipped: true } }} />);
    expect(bar).toHaveClass("is-flipped");
    expect(bar.firstElementChild).toHaveStyle("--white-share: 60%");
  });

  it("uses the mated side to display a zero-distance mate", () => {
    const model = {
      state: { ...initialState, game },
      position: { ...game.positions[0], turn: "white" as const },
      navigate: vi.fn(),
      flip: vi.fn(),
      analysis: {
        ...analysis,
        source: "stockfish" as const,
        score: { kind: "mate" as const, value: 0 },
      },
    };
    const { rerender } = render(<GameBoard model={model} />);
    const bar = screen.getByRole("img", { name: "Evaluation: M0, White's perspective" });
    expect(bar.firstElementChild).toHaveStyle("--white-share: 5%");
    rerender(<GameBoard model={{ ...model, position: { ...model.position, turn: "black" } }} />);
    expect(bar.firstElementChild).toHaveStyle("--white-share: 95%");
  });

  it("does not label a pending position as an engine result", () => {
    render(
      <GameBoard
        model={{
          state: { ...initialState, game },
          position: game.positions[0],
          navigate: vi.fn(),
          flip: vi.fn(),
          analysis: undefined,
        }}
      />,
    );
    expect(screen.getByRole("img", { name: "Position not analyzed" })).toBeInTheDocument();
  });
});

describe("FEN-aware move list", () => {
  it("reveals the selected move when its mounted tab is reopened", () => {
    const model = { state: { ...initialState, game, ply: 1 }, navigate: vi.fn() };
    const { rerender } = render(<MoveList model={model} active={false} />);
    const scroll = vi.fn();
    screen.getByRole("button", { name: "Go to move 1: e4" }).scrollIntoView = scroll;
    rerender(<MoveList model={model} active />);
    expect(scroll).toHaveBeenCalledWith({ block: "nearest", behavior: "instant" });
  });
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
      <MoveList
        model={{
          state: { ...initialState, game: custom },
          navigate: vi.fn(),
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
      <MoveList
        model={{
          state: { ...initialState, game: custom },
          navigate: vi.fn(),
        }}
      />,
    );
    const row = screen.getByRole("group", { name: "Move 17" });
    expect(row.children[1]).toHaveAccessibleName("Go to move 1: e4");
    expect(row.children[2]).toHaveAccessibleName("Go to move 2: e5");
  });
});
