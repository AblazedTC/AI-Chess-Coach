import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { analysis, coach, game, job, practice } from "@/test/fixtures";
import { useWorkspace } from "./use-workspace";
import type { AnalysisJob, CoachResponse, GameDetail, Insights } from "@/lib/types";
import { MAX_COACH_CONTENT, MAX_INSIGHT_GAMES, MAX_PRACTICE_MOVES } from "@/lib/limits";
import { summaryOf } from "@/lib/chess";

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
  vi.spyOn(api, "cancelJob").mockResolvedValue({ ...job, status: "cancelled" });
});

describe("request lifecycle", () => {
  it("clears hidden insight selections when a search replaces the library", async () => {
    vi.spyOn(api, "player").mockResolvedValue({
      username: "new-player",
      name: null,
      rating: null,
      avatar: null,
    });
    const games = Array.from({ length: 20 }, (_, index) => ({
      ...summaryOf(game),
      id: `new-${index}`,
    }));
    vi.spyOn(api, "games").mockResolvedValue({ games });
    const { result } = renderHook(useWorkspace);
    await act(async () => {
      await result.current.loadDemo();
    });
    act(() => {
      for (let index = 1; index < MAX_INSIGHT_GAMES; index++)
        result.current.toggleInsightId(`old-${index}`);
    });
    expect(result.current.insightIds).toHaveLength(MAX_INSIGHT_GAMES);
    await act(async () => {
      await result.current.search("new-player");
    });
    expect(result.current.insightIds).toEqual([]);
    act(() => result.current.toggleInsightId("new-0"));
    expect(result.current.insightIds).toEqual(["new-0"]);
  });
  it("preserves insights and selection while following citations across games", async () => {
    const other = { ...game, id: "another-game" };
    vi.spyOn(api, "game").mockImplementation(async (id) => (id === game.id ? game : other));
    const report: Insights = {
      games_analyzed: 2,
      summary: "Two-game report",
      themes: [
        {
          name: "Captures",
          description: "Observed captures",
          count: 2,
          supporting_positions: [
            { game_id: game.id, ply: 2, position_key: "test-2" },
            { game_id: other.id, ply: 1, position_key: "test-1" },
          ],
        },
      ],
      limitations: [],
    };
    vi.spyOn(api, "insights").mockResolvedValue(report);
    const { result } = renderHook(useWorkspace);
    await act(async () => {
      await result.current.loadDemo();
    });
    act(() => result.current.toggleInsightId(other.id));
    await act(async () => {
      await result.current.getInsights();
    });
    act(() =>
      result.current.selectCitation({
        game_id: other.id,
        ply: 1,
        position_key: "test-1",
      }),
    );
    await waitFor(() => expect(result.current.state.game?.id).toBe(other.id));
    expect(result.current.state.ply).toBe(1);
    expect(result.current.insights).toEqual(report);
    expect(result.current.insightIds).toEqual([game.id, other.id]);
    act(() => result.current.selectCitation({ game_id: game.id, ply: 2, position_key: "test-2" }));
    await waitFor(() => expect(result.current.state.game?.id).toBe(game.id));
    expect(result.current.state.ply).toBe(2);
    expect(result.current.insights).toEqual(report);
    await act(async () => {
      await result.current.loadGame(other.id);
    });
    expect(result.current.insights).toBeNull();
    expect(result.current.insightIds).toEqual([other.id]);
  });
  it("discards an old insights response after a search replaces its source games", async () => {
    const pending = deferred<Insights>();
    vi.spyOn(api, "insights").mockReturnValue(pending.promise);
    vi.spyOn(api, "player").mockResolvedValue({
      username: "new-player",
      name: null,
      rating: null,
      avatar: null,
    });
    vi.spyOn(api, "games").mockResolvedValue({ games: [] });
    const { result } = renderHook(useWorkspace);
    await act(async () => {
      await result.current.loadDemo();
    });
    let response!: Promise<void>;
    act(() => {
      response = result.current.getInsights();
    });
    await act(async () => {
      await result.current.search("new-player");
      pending.resolve({ games_analyzed: 1, summary: "Old", themes: [], limitations: [] });
      await response;
    });
    expect(result.current.insights).toBeNull();
    expect(result.current.insightIds).toEqual([]);
    expect(result.current.insightsLoading).toBe(false);
  });
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
  it("cancels a job started while another game is still loading", async () => {
    const nextGame = deferred<GameDetail>();
    vi.spyOn(api, "game").mockReturnValue(nextGame.promise);
    vi.spyOn(api, "startJob").mockResolvedValue(job);
    const { result } = renderHook(useWorkspace);
    await act(async () => {
      await result.current.loadDemo();
    });
    let loading!: Promise<boolean>;
    act(() => {
      loading = result.current.loadGame("next");
    });
    await act(async () => {
      await result.current.analyzeGame();
    });
    expect(result.current.state.job?.id).toBe(job.id);
    await act(async () => {
      nextGame.resolve({ ...game, id: "next" });
      await loading;
    });
    expect(api.cancelJob).toHaveBeenCalledWith(job.id);
    expect(result.current.state.game?.id).toBe("next");
    expect(result.current.state.job).toBeNull();
  });
  it("retrieves and cancels a creation that settles after switching games", async () => {
    const creation = deferred<AnalysisJob>();
    vi.spyOn(api, "startJob").mockReturnValue(creation.promise);
    vi.spyOn(api, "game").mockResolvedValue({ ...game, id: "next" });
    const { result } = renderHook(useWorkspace);
    await act(async () => {
      await result.current.loadDemo();
    });
    let starting!: Promise<void>;
    act(() => {
      starting = result.current.analyzeGame();
    });
    await act(async () => {
      await result.current.loadGame("next");
    });
    await act(async () => {
      creation.resolve(job);
      await starting;
    });
    expect(api.startJob).toHaveBeenCalledWith(game.id);
    expect(api.cancelJob).toHaveBeenCalledWith(job.id);
    expect(result.current.state.job).toBeNull();
    expect(result.current.jobStarting).toBe(false);
  });
  it("cancels a creation that settles after unmount without aborting its POST", async () => {
    const creation = deferred<AnalysisJob>();
    vi.spyOn(api, "startJob").mockReturnValue(creation.promise);
    const { result, unmount } = renderHook(useWorkspace);
    await act(async () => {
      await result.current.loadDemo();
    });
    let starting!: Promise<void>;
    act(() => {
      starting = result.current.analyzeGame();
    });
    unmount();
    await act(async () => {
      creation.resolve(job);
      await starting;
    });
    expect(api.startJob).toHaveBeenCalledWith(game.id);
    expect(api.cancelJob).toHaveBeenCalledWith(job.id);
  });
  it("keeps a newer creation pending when an old creation settles", async () => {
    const oldCreation = deferred<AnalysisJob>();
    const newCreation = deferred<AnalysisJob>();
    vi.spyOn(api, "startJob")
      .mockReturnValueOnce(oldCreation.promise)
      .mockReturnValueOnce(newCreation.promise);
    vi.spyOn(api, "game").mockResolvedValue({ ...game, id: "next" });
    const { result } = renderHook(useWorkspace);
    await act(async () => {
      await result.current.loadDemo();
    });
    let oldStarting!: Promise<void>;
    act(() => {
      oldStarting = result.current.analyzeGame();
    });
    await act(async () => {
      await result.current.loadGame("next");
    });
    let newStarting!: Promise<void>;
    act(() => {
      newStarting = result.current.analyzeGame();
    });
    await act(async () => {
      oldCreation.resolve(job);
      await oldStarting;
    });
    expect(result.current.jobStarting).toBe(true);
    await act(async () => {
      newCreation.resolve({ ...job, id: "new-job", game_id: "next" });
      await newStarting;
    });
    expect(result.current.state.job?.id).toBe("new-job");
    expect(result.current.jobStarting).toBe(false);
  });
  it("caps even batched insight selections at ten before making a request", async () => {
    vi.spyOn(api, "insights").mockResolvedValue({
      games_analyzed: MAX_INSIGHT_GAMES,
      summary: "Limited facts",
      themes: [],
      limitations: [],
    });
    const { result } = renderHook(useWorkspace);
    act(() => {
      for (let index = 0; index < 12; index++) result.current.toggleInsightId(`game-${index}`);
    });
    expect(result.current.insightIds).toHaveLength(MAX_INSIGHT_GAMES);
    await act(async () => {
      await result.current.getInsights();
    });
    expect(api.insights).toHaveBeenCalledWith(
      Array.from({ length: 10 }, (_, index) => `game-${index}`),
      expect.any(AbortSignal),
    );
    act(() => result.current.toggleInsightId("game-0"));
    act(() => result.current.toggleInsightId("game-11"));
    expect(result.current.insightIds).toHaveLength(MAX_INSIGHT_GAMES);
    expect(result.current.insightIds).toContain("game-11");
  });
  it("rejects oversized coach questions locally but accepts a trimmed 2000-character question", async () => {
    vi.spyOn(api, "coach").mockResolvedValue(coach);
    const { result } = renderHook(useWorkspace);
    await act(async () => {
      await result.current.loadDemo();
    });
    await act(async () => {
      await result.current.askCoach("x".repeat(MAX_COACH_CONTENT + 1));
    });
    expect(api.coach).not.toHaveBeenCalled();
    expect(result.current.coachError).toMatch(/2,000 characters or fewer/);
    await act(async () => {
      await result.current.askCoach(`  ${"x".repeat(MAX_COACH_CONTENT)}  `);
    });
    expect(api.coach).toHaveBeenCalledWith(
      game.id,
      0,
      "x".repeat(MAX_COACH_CONTENT),
      [],
      expect.any(AbortSignal),
    );
  });
  it("bounds generated assistant history while retaining the full response for display", async () => {
    const longResponse = "Evidence ".repeat(500);
    vi.spyOn(api, "coach").mockResolvedValue({ ...coach, message: longResponse });
    const { result } = renderHook(useWorkspace);
    await act(async () => {
      await result.current.loadDemo();
    });
    await act(async () => {
      await result.current.askCoach("Explain");
    });
    expect(result.current.conversation?.response?.message).toBe(longResponse);
    await act(async () => {
      await result.current.askCoach("What next?");
    });
    const sentHistory = vi.mocked(api.coach).mock.calls[1][3];
    expect(sentHistory[1].content).toHaveLength(MAX_COACH_CONTENT);
    expect(sentHistory.every((message) => message.content.length <= MAX_COACH_CONTENT)).toBe(true);
  });
  it("allows the hundredth practice move, rejects the next locally, and allows reset", async () => {
    const moves = Array.from({ length: MAX_PRACTICE_MOVES - 1 }, () => "g1f3");
    vi.mocked(api.practice)
      .mockResolvedValueOnce({ ...practice, moves })
      .mockResolvedValueOnce({ ...practice, moves: [...moves, "e2e4"] })
      .mockResolvedValue(practice);
    const { result } = renderHook(useWorkspace);
    await act(async () => {
      await result.current.loadDemo();
    });
    act(() => result.current.openPractice());
    await waitFor(() => expect(result.current.state.practice?.moves).toHaveLength(99));
    await act(async () => {
      await result.current.playPractice("e2e4");
    });
    expect(vi.mocked(api.practice).mock.calls[1][2]).toHaveLength(MAX_PRACTICE_MOVES);
    expect(result.current.practiceAtLimit).toBe(true);
    await act(async () => {
      await result.current.playPractice("e2e4");
    });
    expect(api.practice).toHaveBeenCalledTimes(2);
    expect(result.current.practiceError).toMatch(/100 moves.*Reset practice/);
    act(() => result.current.resetPractice());
    await waitFor(() => expect(result.current.state.practice?.moves).toHaveLength(0));
    expect(result.current.practiceAtLimit).toBe(false);
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
