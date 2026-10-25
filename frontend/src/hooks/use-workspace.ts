"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { isActiveJob, isTypingTarget, summaryOf } from "@/lib/chess";
import { initialState, reducer } from "@/lib/state";
import type { Citation, GameDetail, GameSummary, Health, Insights, Player } from "@/lib/types";

interface RequestState {
  key: string;
  error?: string;
  pending?: boolean;
}

export function useWorkspace() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [library, setLibrary] = useState<GameSummary[]>([]);
  const [player, setPlayer] = useState<Player | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searched, setSearched] = useState(false);
  const [analysisRequest, setAnalysisRequest] = useState<RequestState>({ key: "" });
  const [analysisRetry, setAnalysisRetry] = useState(0);
  const [coachRequest, setCoachRequest] = useState<RequestState>({ key: "" });
  const [practiceRequest, setPracticeRequest] = useState<RequestState>({ key: "" });
  const [practiceRetry, setPracticeRetry] = useState(0);
  const [jobStarting, setJobStarting] = useState(false);
  const [jobCancelling, setJobCancelling] = useState(false);
  const [jobError, setJobError] = useState("");
  const [insights, setInsights] = useState<Insights | null>(null);
  const [insightIds, setInsightIds] = useState<string[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState("");
  const loadController = useRef<AbortController | null>(null);
  const searchController = useRef<AbortController | null>(null);
  const coachController = useRef<AbortController | null>(null);
  const practiceController = useRef<AbortController | null>(null);
  const jobController = useRef<AbortController | null>(null);
  const insightsController = useRef<AbortController | null>(null);
  const position = state.game?.positions.find((item) => item.ply === state.ply);
  const key =
    state.game && position ? `${state.game.id}:${position.position_key}:${state.ply}` : "";
  const analysis = state.analyses[state.ply];
  const conversation = state.conversations[state.ply];

  useEffect(() => {
    const controller = new AbortController();
    api
      .health(controller.signal)
      .then(setHealth)
      .catch(() => {
        if (!controller.signal.aborted) setHealthError(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(
    () => () => {
      loadController.current?.abort();
      searchController.current?.abort();
      coachController.current?.abort();
      practiceController.current?.abort();
      jobController.current?.abort();
      insightsController.current?.abort();
    },
    [],
  );

  const navigate = useCallback(
    (ply: number) => {
      if (!state.game) return;
      const first = state.game.positions[0]?.ply ?? 0;
      const last = state.game.positions.at(-1)?.ply ?? 0;
      const target = Math.max(first, Math.min(ply, last));
      if (target === state.ply || !state.game.positions.some((item) => item.ply === target)) return;
      coachController.current?.abort();
      practiceController.current?.abort();
      setCoachRequest({ key: "" });
      setPracticeRequest({ key: "" });
      dispatch({ type: "navigate", ply: target });
    },
    [state.game, state.ply],
  );

  useEffect(() => {
    if (!state.game) return;
    const last = state.game.positions.at(-1)?.ply ?? 0;
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return;
      let next: number | undefined;
      if (event.key === "ArrowRight") next = state.ply + 1;
      if (event.key === "ArrowLeft") next = state.ply - 1;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = last;
      if (next !== undefined) {
        event.preventDefault();
        navigate(next);
      }
      if (event.key.toLowerCase() === "f") dispatch({ type: "flip" });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.game, state.ply, navigate]);

  useEffect(() => {
    if (!state.game || !position || analysis) return;
    const controller = new AbortController();
    api
      .position(state.game.id, position.ply, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          dispatch({ type: "analysis", analysis: result });
          setAnalysisRequest({ key });
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setAnalysisRequest({ key, error: errorMessage(cause) });
      });
    return () => controller.abort();
  }, [state.game, position, analysis, key, analysisRetry]);

  useEffect(() => {
    return () => {
      coachController.current?.abort();
      practiceController.current?.abort();
    };
  }, [key]);

  useEffect(() => {
    if (!state.practiceOpen || !state.game || !position) return;
    const controller = new AbortController();
    practiceController.current?.abort();
    practiceController.current = controller;
    api
      .practice(state.game.id, position.ply, [], controller.signal)
      .then((practice) => {
        if (!controller.signal.aborted) {
          dispatch({ type: "practice", gameId: state.game!.id, ply: position.ply, practice });
          setPracticeRequest({ key });
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setPracticeRequest({ key, error: errorMessage(cause) });
      });
    return () => controller.abort();
  }, [state.practiceOpen, state.game, position, key, practiceRetry]);

  const currentJob = state.job;
  useEffect(() => {
    if (!currentJob || !isActiveJob(currentJob.status)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const job = await api.job(currentJob.id, controller.signal);
        if (!controller.signal.aborted) dispatch({ type: "job", job });
      } catch (cause) {
        if (!controller.signal.aborted) setJobError(errorMessage(cause));
      }
    }, 600);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [currentJob]);

  async function load(
    fetchGame: (signal: AbortSignal) => Promise<GameDetail>,
    selectedPly = 0,
  ): Promise<boolean> {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setError("");
    try {
      const game = await fetchGame(controller.signal);
      if (controller.signal.aborted) return false;
      if (!game.positions.length) throw new Error("This game has no positions to explore.");
      void api
        .health(controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setHealth(result);
            setHealthError(false);
          }
        })
        .catch(() => undefined);
      coachController.current?.abort();
      practiceController.current?.abort();
      jobController.current?.abort();
      insightsController.current?.abort();
      if (state.job && isActiveJob(state.job.status)) {
        void api.cancelJob(state.job.id).catch(() => undefined);
      }
      dispatch({ type: "load", game, ply: selectedPly });
      setLibrary((previous) =>
        previous.some((item) => item.id === game.id) ? previous : [summaryOf(game), ...previous],
      );
      setInsightIds([game.id]);
      setInsights(null);
      setInsightsError("");
      setInsightsLoading(false);
      setCoachRequest({ key: "" });
      setPracticeRequest({ key: "" });
      setAnalysisRequest({ key: "" });
      setJobError("");
      setJobStarting(false);
      setJobCancelling(false);
      return true;
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
      return false;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  async function search(username: string) {
    const value = username.trim();
    if (!value) return;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setSearching(true);
    setSearchError("");
    setSearched(false);
    setPlayer(null);
    try {
      const [profile, result] = await Promise.all([
        api.player(value, controller.signal),
        api.games(value, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setPlayer(profile);
      setLibrary(result.games);
      setSearched(true);
    } catch (cause) {
      if (!controller.signal.aborted) {
        controller.abort();
        setSearchError(errorMessage(cause));
        setSearching(false);
      }
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  async function askCoach(question: string) {
    const value = question.trim();
    if (!state.game || !value || !position) return;
    coachController.current?.abort();
    const controller = new AbortController();
    coachController.current = controller;
    setCoachRequest({ key, pending: true });
    try {
      const response = await api.coach(
        state.game.id,
        position.ply,
        value,
        conversation?.messages.slice(-12) || [],
        controller.signal,
      );
      if (!controller.signal.aborted) {
        dispatch({ type: "coach", response, question: value });
        setCoachRequest({ key });
      }
    } catch (cause) {
      if (!controller.signal.aborted) setCoachRequest({ key, error: errorMessage(cause) });
    }
  }

  async function playPractice(move: string) {
    if (!state.game || !state.practice || !position) return;
    const value = move.trim().toLowerCase();
    if (!state.practice.legal_moves.includes(value)) {
      setPracticeRequest({
        key,
        error: "That move is not legal here. Use UCI notation, such as e2e4 (or e7e8q to promote).",
      });
      return;
    }
    practiceController.current?.abort();
    const controller = new AbortController();
    practiceController.current = controller;
    setPracticeRequest({ key, pending: true });
    try {
      const practice = await api.practice(
        state.game.id,
        position.ply,
        [...state.practice.moves, value],
        controller.signal,
      );
      if (!controller.signal.aborted) {
        dispatch({ type: "practice", gameId: state.game.id, ply: position.ply, practice });
        setPracticeRequest({ key });
      }
    } catch (cause) {
      if (!controller.signal.aborted) setPracticeRequest({ key, error: errorMessage(cause) });
    }
  }

  function resetPractice() {
    practiceController.current?.abort();
    setPracticeRequest({ key: "" });
    dispatch({ type: "practice-open", open: true });
    setPracticeRetry((value) => value + 1);
  }

  async function analyzeGame() {
    if (!state.game || jobStarting || isActiveJob(state.job?.status)) return;
    jobController.current?.abort();
    const controller = new AbortController();
    jobController.current = controller;
    setJobStarting(true);
    setJobError("");
    try {
      const job = await api.startJob(state.game.id, controller.signal);
      if (!controller.signal.aborted) dispatch({ type: "job", job });
    } catch (cause) {
      if (!controller.signal.aborted) setJobError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted) setJobStarting(false);
    }
  }

  async function cancelAnalysis() {
    if (!state.job || !isActiveJob(state.job.status)) return;
    jobController.current?.abort();
    const controller = new AbortController();
    jobController.current = controller;
    setJobCancelling(true);
    setJobError("");
    try {
      const job = await api.cancelJob(state.job.id, controller.signal);
      if (!controller.signal.aborted) dispatch({ type: "job", job });
    } catch (cause) {
      if (!controller.signal.aborted) setJobError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted) setJobCancelling(false);
    }
  }

  async function getInsights() {
    if (!insightIds.length) return;
    insightsController.current?.abort();
    const controller = new AbortController();
    insightsController.current = controller;
    setInsightsLoading(true);
    setInsightsError("");
    setInsights(null);
    try {
      const result = await api.insights(insightIds, controller.signal);
      if (!controller.signal.aborted) setInsights(result);
    } catch (cause) {
      if (!controller.signal.aborted) setInsightsError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted) setInsightsLoading(false);
    }
  }

  function toggleInsightId(id: string) {
    insightsController.current?.abort();
    setInsightsLoading(false);
    setInsights(null);
    setInsightsError("");
    setInsightIds((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    );
  }

  function selectCitation(citation: Citation) {
    if (citation.game_id === state.game?.id) navigate(citation.ply);
    else void load((signal) => api.game(citation.game_id, signal), citation.ply);
  }

  return {
    state,
    position,
    analysis,
    conversation,
    health,
    healthError,
    loading,
    error,
    library,
    player,
    searching,
    searchError,
    searched,
    analysisError: analysisRequest.key === key ? analysisRequest.error : undefined,
    coachBusy: coachRequest.key === key && Boolean(coachRequest.pending),
    coachError: coachRequest.key === key ? coachRequest.error : undefined,
    practiceBusy:
      state.practiceOpen &&
      ((!state.practice && !(practiceRequest.key === key && practiceRequest.error)) ||
        (practiceRequest.key === key && Boolean(practiceRequest.pending))),
    practiceError: practiceRequest.key === key ? practiceRequest.error : undefined,
    jobStarting,
    jobCancelling,
    jobError,
    insights,
    insightIds,
    insightsLoading,
    insightsError,
    navigate,
    flip: () => dispatch({ type: "flip" }),
    loadDemo: () => load((signal) => api.demo(signal)),
    loadGame: (id: string) => load((signal) => api.game(id, signal)),
    importPgn: (pgn: string) => load((signal) => api.import(pgn, signal)),
    search,
    askCoach,
    playPractice,
    resetPractice,
    openPractice: () => {
      setPracticeRequest({ key: "" });
      dispatch({ type: "practice-open", open: !state.practiceOpen });
    },
    analyzeGame,
    cancelAnalysis,
    getInsights,
    toggleInsightId,
    selectCitation,
    retryAnalysis: () => {
      setAnalysisRequest({ key: "" });
      setAnalysisRetry((value) => value + 1);
    },
    retryJob: () => {
      setJobError("");
      if (state.job) dispatch({ type: "job", job: { ...state.job } });
    },
  };
}

export type WorkspaceModel = ReturnType<typeof useWorkspace>;
