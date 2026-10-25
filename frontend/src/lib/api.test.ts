import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, request } from "./api";
import { jsonResponse } from "@/test/fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("uses the fixed snake_case JSON contract", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    await api.coach("a-game", 3, "Why?", []);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/api/coach"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ game_id: "a-game", ply: 3, question: "Why?", history: [] }),
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  it("encodes usernames and ids as path components", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal("fetch", fetcher);
    await api.player("name with/slash");
    expect(fetcher.mock.calls[0][0]).toContain("name%20with%2Fslash");
  });
  it("surfaces structured backend errors without exposing raw payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: { code: "invalid_pgn", message: "Invalid PGN." }, request_id: "r1" },
            422,
          ),
        ),
    );
    await expect(api.import("bad")).rejects.toMatchObject({
      name: "ApiError",
      message: "Invalid PGN.",
      code: "invalid_pgn",
      requestId: "r1",
    });
  });
  it("handles non-JSON errors with a safe fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>server failed</html>", { status: 500 })),
    );
    await expect(request("/test")).rejects.toBeInstanceOf(ApiError);
  });
  it("handles unreachable service and successful empty response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(request("/test")).rejects.toThrow("Cannot reach");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(request("/test")).rejects.toThrow("empty response");
  });
  it("preserves abort errors for cancelled requests", async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(request("/test", { signal: controller.signal })).rejects.toBe(abort);
  });
});
