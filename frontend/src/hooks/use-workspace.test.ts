import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { analysis, coach, game, job, practice } from "@/test/fixtures";
import { useWorkspace } from "./use-workspace";
import type { CoachResponse, GameDetail, Insights } from "@/lib/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.spyOn(api, "health").mockResolvedValue({
    status: "ok",
    engine_mode: "demo",
    coach_mode: "deterministic",
  });
  vi.spyOn(api, "demo").mockResolvedValue(game);
  vi.spyOn(api, "position").mockImplementation(async (gameId, ply) => ({
    ...analysis,
    game_id: gameId,
    ply,
    position_key: `test-${ply}`,
  }));
  vi.spyOn(api, "practice").mockResolvedValue(practice);
});

describe("request lifecycle", () => {
  it("does not let an older load overwrite a newer selected game", async () => {
    const old = deferred<GameDetail>();
    vi.mocked(api.demo).mockReturnValueOnce(old.promise);
    vi.spyOn(api, "game").mockResolvedValue({ ...game, id: "new-game" });
    const { result } = renderHook(useWorkspace);
    let oldPromise!: Promise<boolean>;
    act(() => {
      oldPromise = result.current.loadDemo();
    });
    await act(async () => {
      await result.current.loadGame("new-game");
    });
    await act(async () => {
      old.resolve(game);
      await oldPromise;
    });
    expect(result.current.state.game?.id).toBe("new-game");
    expect(result.current.loading).toBe(false);
  });
  it("ignores an aborted coach reply even when the service finishes it", async () => {
    const pending = deferred<CoachResponse>();
    vi.spyOn(api, "coach").mockReturnValue(pending.promise);
    const { result } = renderHook(useWorkspace);
    await act(async () => {
      await result.current.loadDemo();
    });
    let answer!: Promise<void>;
    act(() => {
      answer = result.current.askCoach("Why?");
    });
    act(() => result.current.navigate(1));
    await act(async () => {
      pending.resolve(coach);
      await answer;
    });
    expect(result.current.state.ply).toBe(1);
    expect(result.current.state.conversations).toEqual({});
    act(() => result.current.navigate(0));
    expect(result.current.coachBusy).toBe(false);
  });
  it("does not abort the current request when navigation stays at a boundary", async () => {
    const pending = deferred<CoachResponse>();
    vi.spyOn(api, "coach").mockReturnValue(pending.promise);
    const { result } = renderHook(useWorkspace);
    await act(async () => {
      await result.current.loadDemo();
    });
    let answer!: Promise<void>;
    act(() => {
      answer = result.current.askCoach("Why?");
    });
    act(() => result.current.navigate(-1));
    expect(result.current.coachBusy).toBe(true);
    await act(async () => {
      pending.resolve(coach);
      await answer;
    });
    expect(result.current.conversation?.response).toEqual(coach);
  });
  it("clears a previous analysis error when revisiting a position succeeds", async () => {
    vi.mocked(api.position).mockRejectedValueOnce(new Error("Try again later."));
    const { result } = renderHook(useWorkspace);
    await act(async () => {
      await result.current.loadDemo();
    });
    await waitFor(() => expect(result.current.analysisError).toBe("Try again later."));
    act(() => result.current.navigate(1));
    await waitFor(() => expect(result.current.analysis?.ply).toBe(1));
    act(() => result.current.navigate(0));
    await waitFor(() => expect(result.current.analysis?.ply).toBe(0));
    expect(result.current.analysisError).toBeUndefined();
  });
  it("discards insights when their selected game set changes", async () => {
    const pending = deferred<Insights>();
    vi.spyOn(api, "insights").mockReturnValue(pending.promise);
    const { result } = renderHook(useWorkspace);
    await act(async () => {
      await result.current.loadDemo();
    });
    let response!: Promise<void>;
    act(() => {
      response = result.current.getInsights();
    });
    act(() => result.current.toggleInsightId(game.id));
    await act(async () => {
      pending.resolve({ games_analyzed: 1, summary: "Old insights", themes: [], limitations: [] });
      await response;
    });
    expect(result.current.insights).toBeNull();
    expect(result.current.insightsLoading).toBe(false);
    expect(result.current.insightIds).toEqual([]);
  });
  it("refreshes an initially unavailable health status after a successful game load", async () => {
    vi.mocked(api.health).mockRejectedValueOnce(new Error("Offline"));
    const { result } = renderHook(useWorkspace);
    await waitFor(() => expect(result.current.healthError).toBe(true));
    await act(async () => {
      await result.current.loadDemo();
    });
    await waitFor(() => expect(result.current.healthError).toBe(false));
    expect(result.current.health?.engine_mode).toBe("demo");
  });
  it("polls a full-game analysis through completion", async () => {
    vi.spyOn(api, "startJob").mockResolvedValue(job);
    const poll = vi
      .spyOn(api, "job")
      .mockResolvedValue({ ...job, status: "completed", completed: 3 });
    const { result } = renderHook(useWorkspace);
    await act(async () => {
      await result.current.loadDemo();
    });
    await act(async () => {
      await result.current.analyzeGame();
    });
    await waitFor(() => expect(result.current.state.job?.status).toBe("completed"), {
      timeout: 2000,
    });
    expect(poll).toHaveBeenCalledTimes(1);
  });
  it("cancels full-game analysis without losing completed positions", async () => {
    vi.spyOn(api, "startJob").mockResolvedValue(job);
    vi.spyOn(api, "cancelJob").mockResolvedValue({ ...job, status: "cancelled" });
    const { result } = renderHook(useWorkspace);
    await act(async () => {
      await result.current.loadDemo();
    });
    await act(async () => {
      await result.current.analyzeGame();
    });
    await act(async () => {
      await result.current.cancelAnalysis();
    });
    expect(result.current.state.job?.status).toBe("cancelled");
    expect(result.current.state.analyses[0]).toEqual(analysis);
  });
  it("clears a failed search and prevents a slow older username from replacing it", async () => {
    const first = deferred<{ games: [] }>();
    vi.spyOn(api, "player").mockImplementation(async (username) => ({
      username,
      name: null,
      rating: null,
      avatar: null,
    }));
    vi.spyOn(api, "games").mockImplementation((username) =>
      username === "old" ? first.promise : Promise.resolve({ games: [] }),
    );
    const { result } = renderHook(useWorkspace);
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.search("old");
    });
    await act(async () => {
      await result.current.search("new");
    });
    await act(async () => {
      first.resolve({ games: [] });
      await pending;
    });
    expect(result.current.player?.username).toBe("new");
    expect(result.current.searching).toBe(false);
  });
});
