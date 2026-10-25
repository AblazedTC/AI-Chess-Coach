import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { START_FEN } from "@/lib/chess";
import { Board } from "./board";

describe("Board", () => {
  it("exposes the current FEN and accessible square descriptions", () => {
    render(<Board fen={START_FEN} />);
    const board = screen.getByRole("group", { name: "Chess board" });
    expect(board).toHaveAttribute("data-fen", START_FEN);
    expect(within(board).getAllByRole("img")).toHaveLength(64);
    expect(within(board).getByLabelText("e1, white king")).toBeInTheDocument();
    expect(within(board).getByLabelText("e8, black king")).toBeInTheDocument();
  });
  it("reverses board coordinates on flip", () => {
    const { rerender } = render(<Board fen={START_FEN} />);
    const board = screen.getByRole("group", { name: "Chess board" });
    expect(board.firstElementChild).toHaveAttribute("aria-label", "a8, black rook");
    rerender(<Board fen={START_FEN} flipped />);
    expect(board.firstElementChild).toHaveAttribute("aria-label", "h1, white rook");
  });
  it("allows only legal destination clicks in practice", () => {
    const move = vi.fn();
    render(<Board fen={START_FEN} label="Practice board" legalMoves={["e2e4"]} onMove={move} />);
    fireEvent.click(screen.getByRole("button", { name: "e2, white pawn" }));
    expect(screen.getByRole("button", { name: "e2, white pawn" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "e4, empty" }));
    expect(move).toHaveBeenCalledWith("e2e4");
    fireEvent.click(screen.getByRole("button", { name: "e3, empty" }));
    expect(move).toHaveBeenCalledTimes(1);
  });
  it("chooses queen promotion by default for board interaction", () => {
    const move = vi.fn();
    render(
      <Board fen="4k3/P7/8/8/8/8/8/4K3 w - - 0 1" legalMoves={["a7a8n", "a7a8q"]} onMove={move} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "a7, white pawn" }));
    fireEvent.click(screen.getByRole("button", { name: "a8, empty" }));
    expect(move).toHaveBeenCalledWith("a7a8q");
  });
  it("disables practice during requests", () => {
    render(<Board fen={START_FEN} legalMoves={["e2e4"]} onMove={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "e2, white pawn" })).toBeDisabled();
  });
  it("keeps decorative rank and file text out of square accessible names", () => {
    render(<Board fen={START_FEN} legalMoves={["a2a4"]} onMove={vi.fn()} />);
    const square = screen.getByRole("button", { name: "a1, white rook" });
    expect(square.querySelector(".rank-label, .file-label")).toBeNull();
    const coordinates = square.parentElement?.querySelectorAll(".rank-label, .file-label");
    expect(coordinates).toHaveLength(2);
    for (const coordinate of coordinates ?? []) {
      expect(coordinate).toHaveAttribute("aria-hidden", "true");
    }
  });
});
