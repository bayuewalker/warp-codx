/**
 * Task #35 — Direct route tests for `POST /api/prs/[number]/close`.
 *
 * Covers the route layer that wraps the `closePR` adapter:
 *   - production-debug auth gate
 *   - request-param + body validation (reason required, ≤ 1000 chars)
 *   - already-closed / merged → 409 short-circuit
 *   - successful 200 response shape (closed / commentPosted / prNumber)
 *     + audit row {action: "close", verdict: "ok"}
 *   - getPRDetail 404 → 404, other failure → 500
 *   - closePR throw → 500 (no audit row)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPRDetailMock = vi.fn();
const closePRMock = vi.fn();
const isAdminAllowedMock = vi.fn();
const supabaseInsertMock = vi.fn();
const supabaseFromMock = vi.fn();
const getServerSupabaseMock = vi.fn();

vi.mock("@/lib/github-prs", () => ({
  getPRDetail: getPRDetailMock,
  closePR: closePRMock,
}));

vi.mock("@/lib/adminGate", () => ({
  isAdminAllowed: isAdminAllowedMock,
}));

vi.mock("@/lib/supabase", () => ({
  getServerSupabase: getServerSupabaseMock,
}));

// Phase 4 — sendPushToAll is fire-and-forget and must never affect
// route behavior. Mock returns a resolved promise; impl is re-applied
// in beforeEach because `vi.clearAllMocks()` in afterEach strips it.
const sendPushToAllMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/push-server", () => ({
  sendPushToAll: sendPushToAllMock,
}));

// Phase 3.5 (option a) — writeTaskCompleteMessage is fire-and-forget
// and must never affect route behavior. Same isolation pattern as
// `sendPushToAll` above.
const writeTaskCompleteMessageMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/task-complete-write", () => ({
  writeTaskCompleteMessage: writeTaskCompleteMessageMock,
}));

beforeEach(() => {
  getPRDetailMock.mockReset();
  closePRMock.mockReset();
  isAdminAllowedMock.mockReset();
  supabaseInsertMock.mockReset();
  supabaseFromMock.mockReset();
  getServerSupabaseMock.mockReset();

  isAdminAllowedMock.mockReturnValue(true);
  supabaseInsertMock.mockResolvedValue({ error: null });
  supabaseFromMock.mockReturnValue({ insert: supabaseInsertMock });
  getServerSupabaseMock.mockReturnValue({ from: supabaseFromMock });

  // Re-apply push impl after afterEach's `vi.clearAllMocks`.
  sendPushToAllMock.mockReset();
  sendPushToAllMock.mockResolvedValue(undefined);

  // Same re-apply for the task-complete write helper.
  writeTaskCompleteMessageMock.mockReset();
  writeTaskCompleteMessageMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/prs/42/close", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function makePRDetail(overrides: Record<string, unknown> = {}) {
  return {
    number: 42,
    title: "WARP/feat — title",
    body: "",
    branch: "WARP/feat-clean",
    baseBranch: "main",
    author: "bayuewalker",
    state: "open" as const,
    merged: false,
    mergeable: true,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    updatedAt: "2026-04-30T12:00:00Z",
    createdAt: "2026-04-29T12:00:00Z",
    url: "https://github.com/bayuewalker/walkermind-os/pull/42",
    headSha: "abc123",
    reviews: [],
    ...overrides,
  };
}

describe("POST /api/prs/[number]/close — auth gate", () => {
  it("returns 403 forbidden when isAdminAllowed === false", async () => {
    isAdminAllowedMock.mockReturnValueOnce(false);
    const { POST } = await import("./route");

    const res = await POST(makeReq({ reason: "x" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(getPRDetailMock).not.toHaveBeenCalled();
    expect(closePRMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/prs/[number]/close — input validation", () => {
  it("returns 400 when number is not a positive integer", async () => {
    const { POST } = await import("./route");

    const res = await POST(makeReq({ reason: "x" }), {
      params: { number: "0" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "pr number must be a positive integer",
    });
  });

  it("returns 400 invalid_json on malformed JSON", async () => {
    const { POST } = await import("./route");

    const req = new Request("http://localhost/api/prs/42/close", {
      method: "POST",
      body: "{not-json",
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req, { params: { number: "42" } });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("returns 400 when reason is empty (or only whitespace)", async () => {
    const { POST } = await import("./route");

    for (const bad of ["", "   ", "\n\t"]) {
      const res = await POST(makeReq({ reason: bad }), {
        params: { number: "42" },
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "reason is required" });
    }
    expect(getPRDetailMock).not.toHaveBeenCalled();
  });

  it("returns 400 when reason exceeds 1000 chars", async () => {
    const { POST } = await import("./route");

    const tooLong = "x".repeat(1001);
    const res = await POST(makeReq({ reason: tooLong }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "reason must be ≤ 1000 chars",
    });
    expect(getPRDetailMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/prs/[number]/close — already-closed / merged", () => {
  it("returns 409 when the PR is already closed", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail({ state: "closed" }));
    const { POST } = await import("./route");

    const res = await POST(makeReq({ reason: "stale" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "PR is already closed" });
    expect(closePRMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the PR is already merged", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail({ state: "merged" }));
    const { POST } = await import("./route");

    const res = await POST(makeReq({ reason: "stale" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "PR is already merged" });
    expect(closePRMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/prs/[number]/close — success path", () => {
  it("returns 200 with the canonical shape and audits {action: close, verdict: ok}", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    closePRMock.mockResolvedValueOnce({ closed: true, commentPosted: true });

    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ sessionId: "sess-2", reason: "  ship blocker  " }),
      { params: { number: "42" } },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      closed: true,
      commentPosted: true,
      prNumber: 42,
    });
    // The reason is trimmed before being forwarded + audited.
    expect(closePRMock).toHaveBeenCalledWith(42, "ship blocker");
    expect(supabaseInsertMock.mock.calls[0][0]).toEqual({
      session_id: "sess-2",
      pr_number: 42,
      reason: "ship blocker",
      action: "close",
      verdict: "ok",
    });
  });

  it("succeeds even when the audit insert errors (best-effort)", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    closePRMock.mockResolvedValueOnce({ closed: true, commentPosted: true });
    supabaseInsertMock.mockResolvedValueOnce({
      error: { message: "supabase down" },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("./route");
    const res = await POST(makeReq({ reason: "x" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(200);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("POST /api/prs/[number]/close — error mapping", () => {
  it("maps `github_detail_404` to HTTP 404", async () => {
    getPRDetailMock.mockRejectedValueOnce(
      new Error("github_detail_404: Not Found"),
    );
    const { POST } = await import("./route");

    const res = await POST(makeReq({ reason: "x" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "github_detail_404: Not Found",
    });
    expect(closePRMock).not.toHaveBeenCalled();
  });

  it("maps `github_detail_401` (Bad credentials) to HTTP 401", async () => {
    getPRDetailMock.mockRejectedValueOnce(
      new Error("github_detail_401: HttpError: Bad credentials"),
    );
    const { POST } = await import("./route");

    const res = await POST(makeReq({ reason: "x" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "github_detail_401: HttpError: Bad credentials",
    });
  });

  it("maps a `github_close_422` adapter throw to HTTP 422 (no audit row)", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    closePRMock.mockRejectedValueOnce(
      new Error("github_close_422: HttpError: Validation Failed"),
    );

    const { POST } = await import("./route");
    const res = await POST(makeReq({ reason: "x" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "github_close_422: HttpError: Validation Failed",
    });
    expect(supabaseInsertMock).not.toHaveBeenCalled();
  });

  it("maps a `github_close_404` adapter throw to HTTP 404 (no audit row)", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    closePRMock.mockRejectedValueOnce(
      new Error("github_close_404: HttpError: Not Found"),
    );

    const { POST } = await import("./route");
    const res = await POST(makeReq({ reason: "x" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(404);
    expect(supabaseInsertMock).not.toHaveBeenCalled();
  });

  it("falls through to HTTP 500 for unrecognized close status codes", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    closePRMock.mockRejectedValueOnce(
      new Error("github_close_500: HttpError: boom"),
    );

    const { POST } = await import("./route");
    const res = await POST(makeReq({ reason: "x" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(500);
    expect(supabaseInsertMock).not.toHaveBeenCalled();
  });
});
