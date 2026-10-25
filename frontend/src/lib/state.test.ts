import { describe, expect, it } from "vitest";
import { analysis, coach, game, job, practice } from "@/test/fixtures";
import { initialState, reducer } from "./state";

const loaded = () => reducer(initialState, { type: "load", game });

describe("workspace reducer", () => {
  it("starts a game at position zero and preserves orientation", () => {
    const state = reducer({ ...initialState, flipped: true }, { type: "load", game });
    expect(state.ply).toBe(0);
    expect(state.flipped).toBe(true);
  });
  it("clamps navigation to available positions", () => {
    expect(reducer(loaded(), { type: "navigate", ply: 99 }).ply).toBe(2);
    expect(reducer(loaded(), { type: "navigate", ply: -99 }).ply).toBe(0);
  });
  it("does nothing when navigating without a game", () => {
    expect(reducer(initialState, { type: "navigate", ply: 1 })).toBe(initialState);
  });
  it("can load directly to a cited ply", () => {
    expect(reducer(initialState, { type: "load", game, ply: 2 }).ply).toBe(2);
  });
  it("rejects analysis from a stale game or mismatched position key", () => {
    const state = loaded();
    expect(reducer(state, { type: "analysis", analysis: { ...analysis, game_id: "old" } })).toBe(
      state,
    );
    expect(
      reducer(state, { type: "analysis", analysis: { ...analysis, position_key: "old" } }),
    ).toBe(state);
  });
  it("stores valid analysis by ply", () => {
    expect(reducer(loaded(), { type: "analysis", analysis }).analyses[0]).toEqual(analysis);
  });
  it("preserves conversation per position and appends alternating messages", () => {
    let state = reducer(loaded(), { type: "coach", response: coach, question: "Why?" });
    state = reducer(state, { type: "navigate", ply: 1 });
    expect(state.conversations[1]).toBeUndefined();
    state = reducer(state, { type: "navigate", ply: 0 });
    state = reducer(state, { type: "coach", response: coach, question: "What next?" });
    expect(state.conversations[0].messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });
  it("rejects coach replies after leaving their position", () => {
    const state = reducer(loaded(), { type: "navigate", ply: 1 });
    expect(reducer(state, { type: "coach", response: coach, question: "Why?" })).toBe(state);
  });
  it("never mutates the original game when practicing", () => {
    const state = reducer(loaded(), { type: "practice", gameId: game.id, ply: 0, practice });
    expect(state.game).toBe(game);
    expect(state.game?.positions[0].fen).toBe(practice.fen);
    const next = reducer(state, { type: "navigate", ply: 1 });
    expect(next.practice).toBeNull();
    expect(next.game).toBe(game);
  });
  it("ignores stale practice replies", () => {
    const state = loaded();
    expect(reducer(state, { type: "practice", gameId: "old", ply: 0, practice })).toBe(state);
    expect(reducer(state, { type: "practice", gameId: game.id, ply: 1, practice })).toBe(state);
  });
  it("resets practice independently", () => {
    const state = reducer(loaded(), { type: "practice", gameId: game.id, ply: 0, practice });
    expect(reducer(state, { type: "practice-open", open: true }).practice).toBeNull();
  });
  it("merges only grounded analysis from a matching full-game job", () => {
    const state = reducer(loaded(), {
      type: "job",
      job: { ...job, analyses: [analysis, { ...analysis, ply: 1, position_key: "wrong" }] },
    });
    expect(Object.keys(state.analyses)).toEqual(["0"]);
    expect(reducer(state, { type: "job", job: { ...job, game_id: "old" } })).toBe(state);
  });
  it("does not regress a cancelled job to running after a late poll", () => {
    const state = reducer(loaded(), { type: "job", job: { ...job, status: "cancelled" } });
    expect(reducer(state, { type: "job", job })).toBe(state);
  });
  it("clears analysis, history and practice for a newly selected game", () => {
    let state = reducer(loaded(), { type: "coach", response: coach, question: "Why?" });
    state = reducer(state, { type: "job", job });
    state = reducer(state, { type: "load", game: { ...game, id: "new-game" } });
    expect(state.analyses).toEqual({});
    expect(state.conversations).toEqual({});
    expect(state.practice).toBeNull();
    expect(state.job).toBeNull();
  });
});
