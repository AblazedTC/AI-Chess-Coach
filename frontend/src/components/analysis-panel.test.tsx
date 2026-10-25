import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FullGameAnalysis } from "./analysis-panel";
import { initialState } from "@/lib/state";
import { analysis, game } from "@/test/fixtures";
import type { PositionAnalysis } from "@/lib/types";

function model(analyses: PositionAnalysis[]) {
  return {
    state: {
      ...initialState,
      game,
      analyses: Object.fromEntries(analyses.map((item) => [item.ply, item])),
    },
    jobStarting: false,
    analyzeGame: vi.fn(),
    jobCancelling: false,
    cancelAnalysis: vi.fn(),
    jobError: "",
    retryJob: vi.fn(),
    navigate: vi.fn(),
  };
}

describe("accessible evaluation graph", () => {
  it("keeps every position in a long game reachable with touch-sized scroll targets", () => {
    const longGame = Array.from({ length: 161 }, (_, ply) => ({
      ...analysis,
      ply,
      position_key: `test-${ply}`,
    }));
    const props = model(longGame);
    render(<FullGameAnalysis model={props} />);
    const graph = screen.getByRole("region", { name: "Demo material balance graph" });
    expect(graph).toHaveAttribute("tabindex", "0");
    expect(graph).toHaveAttribute("data-shortcuts", "ignore");
    expect(graph).toHaveAccessibleDescription(/Swipe or scroll horizontally/);
    expect(graph.firstElementChild).toHaveStyle({ minWidth: "3864px" });
    expect(within(graph).getAllByRole("button")).toHaveLength(161);
    fireEvent.click(within(graph).getByRole("button", { name: "Position 160, material 0.00" }));
    expect(props.navigate).toHaveBeenCalledWith(160);
  });
  it.each([
    ["white", "95%"],
    ["black", "5%"],
  ] as const)("plots mate zero with %s to move as that side already mated", (turn, top) => {
    const props = model([{ ...analysis, source: "stockfish", score: { kind: "mate", value: 0 } }]);
    props.state.game = { ...game, positions: [{ ...game.positions[0], turn }] };
    const { container } = render(<FullGameAnalysis model={props} />);
    expect(container.querySelector(".graph-point")).toHaveStyle({ top });
  });
  it("does not invent the winner of mate zero without position context", () => {
    const props = model([
      { ...analysis, ply: 99, source: "stockfish", score: { kind: "mate", value: 0 } },
    ]);
    const { container } = render(<FullGameAnalysis model={props} />);
    expect(container.querySelector(".graph-point")).toBeNull();
    expect(
      screen.getByLabelText("Mate outcome unavailable without position context"),
    ).toHaveTextContent("?");
  });
});
