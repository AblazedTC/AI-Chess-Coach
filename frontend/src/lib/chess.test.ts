import { describe, expect, it } from "vitest";
import {
  boardSquares,
  formatScore,
  isActiveJob,
  isTypingTarget,
  scoreHeight,
  START_FEN,
} from "./chess";
import { analysis } from "@/test/fixtures";

describe("board squares", () => {
  it("expands a FEN to exactly 64 squares and 32 initial pieces", () => {
    const squares = boardSquares(START_FEN);
    expect(squares).toHaveLength(64);
    expect(squares.filter((square) => square.piece)).toHaveLength(32);
    expect(squares[0]).toMatchObject({ square: "a8", piece: "r", light: true });
    expect(squares[63]).toMatchObject({ square: "h1", piece: "R", light: true });
  });
  it("fully reverses the visual board without changing pieces", () => {
    expect(boardSquares(START_FEN, true)).toEqual(boardSquares(START_FEN).reverse());
  });
  it("keeps a1 dark and an empty e4 accessible", () => {
    const squares = boardSquares(START_FEN);
    expect(squares.find((square) => square.square === "a1")?.light).toBe(false);
    expect(squares.find((square) => square.square === "e4")).toMatchObject({
      piece: null,
      name: "empty",
    });
  });
});

describe("evaluation formatting", () => {
  it.each([
    [150, "+1.50"],
    [-75, "-0.75"],
    [0, "0.00"],
  ])("formats cp %s", (value, expected) => {
    expect(formatScore({ kind: "cp", value: Number(value) })).toBe(expected);
  });
  it("retains mate direction and White POV", () => {
    expect(formatScore({ kind: "mate", value: -3 })).toBe("M-3");
    expect(scoreHeight({ ...analysis, score: { kind: "mate", value: 3 } })).toBe(5);
    expect(scoreHeight({ ...analysis, score: { kind: "cp", value: -3000 } })).toBe(95);
  });
});

describe("keyboard targets", () => {
  it.each(["input", "textarea", "select", "button", "a"])("ignores focused %s", (tag) => {
    expect(isTypingTarget(document.createElement(tag))).toBe(true);
  });
  it("allows the dedicated replay controls and body", () => {
    const button = document.createElement("button");
    button.dataset.moveNavigation = "";
    expect(isTypingTarget(button)).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
  });
  it("ignores descendants of dialogs", () => {
    const dialog = document.createElement("dialog");
    const span = document.createElement("span");
    dialog.appendChild(span);
    expect(isTypingTarget(span)).toBe(true);
  });
  it("recognizes only queued/running jobs as active", () => {
    expect(isActiveJob("queued")).toBe(true);
    expect(isActiveJob("running")).toBe(true);
    expect(isActiveJob("cancelled")).toBe(false);
    expect(isActiveJob()).toBe(false);
  });
});
