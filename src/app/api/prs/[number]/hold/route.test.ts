/**
 * Task #35 — Direct route tests for `POST /api/prs/[number]/hold`.
 *
 * Hold is the soft-pause sibling of close — it leaves the PR open on
 * GitHub but adds a `**WARP🔹CMD hold**` comment + an audit row
 * `{action: "hold", verdict: "manual"}` so manual holds stay
 * distinguishable from gate-blocked holds (which the merge route
 * inserts as `verdict: "blocked"`).
 *
 * Coverage mirrors the close route:
 *   - production-debug auth gate
 *   - request-param + body validation (reason required, ≤ 1000 chars)
 *   - already-closed / merged → 409 short-circuit
 *   - successful 200 response shape (held / commentPosted / prNumber)
 *     + audit row {action: "hold", verdict: "manual"}
 *   - getPRDetail 404 → 404, other failure → 500
 *   - holdPR throw → 500 (no audit row)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPRDetailMock = vi.fn();
const holdPRMock = vi.fn();
const isAdminAllowedMock = vi.fn();
const supabaseInsertMock = vi.fn();
const supabaseFromMock = vi.fn();
const getServerSupabaseMock = vi.fn();

vi.mock("@/lib/github-prs", () => ({
  getPRDetail: getPRDetailMock,
  holdPR: holdPRMock,
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
  holdPRMock.mockReset();
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
  return new Request("http://localhost/api/prs/42/hold", {
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

describe("POST /api/prs/[number]/hold — auth gate", () => {
  it("returns 403 forbidden when isAdminAllowed === false", async () => {
    isAdminAllowedMock.mockReturnValueOnce(false);
    const { POST } = await import("./route");

    const res = await POST(makeReq({ reason: "x" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(getPRDetailMock).not.toHaveBeenCalled();
    expect(holdPRMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/prs/[number]/hold — input validation", () => {
  it("returns 400 when number is not a positive integer", async () => {
    const { POST } = await import("./route");

    const res = await POST(makeReq({ reason: "x" }), {
      params: { number: "-1" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "pr number must be a positive integer",
    });
  });

  it("returns 400 invalid_json on malformed JSON body", async () => {
    const { POST } = await import("./route");

    const req = new Request("http://localhost/api/prs/42/hold", {
      method: "POST",
      body: "{not-json",
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req, { params: { number: "42" } });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("returns 400 when reason is empty (every manual HOLD must explain itself)", async () => {
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
  });
});

describe("POST /api/prs/[number]/hold — already-closed / merged", () => {
  it("returns 409 when the PR is already closed", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail({ state: "closed" }));
    const { POST } = await import("./route");

    const res = await POST(makeReq({ reason: "x" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "PR is already closed" });
    expect(holdPRMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the PR is already merged", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail({ state: "merged" }));
    const { POST } = await import("./route");

    const res = await POST(makeReq({ reason: "x" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "PR is already merged" });
    expect(holdPRMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/prs/[number]/hold — success path", () => {
  it("returns 200 with the canonical shape and audits {action: hold, verdict: manual}", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    holdPRMock.mockResolvedValueOnce({ commentPosted: true });

    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ sessionId: "sess-3", reason: "  needs review  " }),
      { params: { number: "42" } },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      held: true,
      prNumber: 42,
      commentPosted: true,
    });
    // Reason is trimmed before being forwarded + audited.
    expect(holdPRMock).toHaveBeenCalledWith(42, "needs review");
    expect(supabaseInsertMock.mock.calls[0][0]).toEqual({
      session_id: "sess-3",
      pr_number: 42,
      reason: "needs review",
      action: "hold",
      verdict: "manual",
    });
  });

  it("returns commentPosted=false when holdPR couldn't post the comment", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    holdPRMock.mockResolvedValueOnce({ commentPosted: false });

    const { POST } = await import("./route");
    const res = await POST(makeReq({ reason: "needs review" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      held: true,
      prNumber: 42,
      commentPosted: false,
    });
  });

  it("succeeds even when the audit insert errors (best-effort)", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    holdPRMock.mockResolvedValueOnce({ commentPosted: true });
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

describe("POST /api/prs/[number]/hold — error mapping", () => {
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
    expect(holdPRMock).not.toHaveBeenCalled();
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

  it("maps a `github_hold_404` adapter throw to HTTP 404 (no audit row)", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    holdPRMock.mockRejectedValueOnce(
      new Error("github_hold_404: HttpError: Not Found"),
    );

    const { POST } = await import("./route");
    const res = await POST(makeReq({ reason: "x" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "github_hold_404: HttpError: Not Found",
    });
    expect(supabaseInsertMock).not.toHaveBeenCalled();
  });

  it("maps a `github_hold_401` adapter throw to HTTP 401 (no audit row)", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    holdPRMock.mockRejectedValueOnce(
      new Error("github_hold_401: HttpError: Bad credentials"),
    );

    const { POST } = await import("./route");
    const res = await POST(makeReq({ reason: "x" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(401);
    expect(supabaseInsertMock).not.toHaveBeenCalled();
  });

  it("maps a `github_hold_422` adapter throw to HTTP 422 (no audit row)", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    holdPRMock.mockRejectedValueOnce(
      new Error("github_hold_422: HttpError: Validation Failed"),
    );

    const { POST } = await import("./route");
    const res = await POST(makeReq({ reason: "x" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(422);
    expect(supabaseInsertMock).not.toHaveBeenCalled();
  });

  it("falls through to HTTP 500 for unrecognized hold status codes", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    holdPRMock.mockRejectedValueOnce(
      new Error("github_hold_500: HttpError: boom"),
    );

    const { POST } = await import("./route");
    const res = await POST(makeReq({ reason: "x" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(500);
    expect(supabaseInsertMock).not.toHaveBeenCalled();
  });
});
