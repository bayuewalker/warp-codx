/**
 * Task #35 — Direct route tests for `POST /api/prs/[number]/merge`.
 *
 * Covers the route layer that executes a PR merge:
 *   - production-debug auth gate
 *   - request-param + body validation
 *   - already-merged / closed → 409 short-circuits
 *   - SENTINEL → paired-FORGE lookup (failure degrades to null)
 *   - gate-blocked → 409 HOLD shape, audit row {action: "hold", verdict: "blocked"}
 *   - gate-ok + mergePR success → 200 with { merged, sha, prNumber, branch,
 *     postMergeReminder }, audit row {action: "merge", verdict: "ok"}
 *   - mergePR throw or `outcome.merged === false` → 500 (no audit row inserted)
 *   - getPRDetail 404 → 404, other failure → 500
 *
 * `@/lib/github-prs`, `@/lib/pr-gates`, `@/lib/adminGate`, and
 * `@/lib/supabase` are mocked. Audit failure is best-effort by design
 * — never undoes the merge — so we assert it's logged but does NOT
 * change the HTTP response.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPRDetailMock = vi.fn();
const mergePRMock = vi.fn();
const findPairedForgePRMock = vi.fn();
const getPRCheckStatusMock = vi.fn();
const evaluateMergeGatesMock = vi.fn();
const isSentinelPRMock = vi.fn();
const isAdminAllowedMock = vi.fn();
const supabaseInsertMock = vi.fn();
const supabaseFromMock = vi.fn();
const getServerSupabaseMock = vi.fn();

vi.mock("@/lib/github-prs", () => ({
  getPRDetail: getPRDetailMock,
  mergePR: mergePRMock,
  findPairedForgePR: findPairedForgePRMock,
  getPRCheckStatus: getPRCheckStatusMock,
}));

vi.mock("@/lib/pr-gates", () => ({
  evaluateMergeGates: evaluateMergeGatesMock,
  isSentinelPR: isSentinelPRMock,
}));

vi.mock("@/lib/adminGate", () => ({
  isAdminAllowed: isAdminAllowedMock,
}));

vi.mock("@/lib/supabase", () => ({
  getServerSupabase: getServerSupabaseMock,
}));

// Phase 4 — sendPushToAll is fire-and-forget and must never affect
// route behavior. Mock to a named vi.fn so we can assert it was
// called AND prove it isn't awaited (see "non-blocking" test below).
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
  mergePRMock.mockReset();
  findPairedForgePRMock.mockReset();
  getPRCheckStatusMock.mockReset();
  evaluateMergeGatesMock.mockReset();
  isSentinelPRMock.mockReset();
  isAdminAllowedMock.mockReset();
  supabaseInsertMock.mockReset();
  supabaseFromMock.mockReset();
  getServerSupabaseMock.mockReset();

  isAdminAllowedMock.mockReturnValue(true);
  isSentinelPRMock.mockReturnValue(false);
  getPRCheckStatusMock.mockResolvedValue("success");

  supabaseInsertMock.mockResolvedValue({ error: null });
  supabaseFromMock.mockReturnValue({ insert: supabaseInsertMock });
  getServerSupabaseMock.mockReturnValue({ from: supabaseFromMock });

  // Push mock is shared across all merge tests; reset per-test so the
  // call count is clean. Default impl resolves immediately; the
  // "non-blocking" test overrides to never resolve.
  sendPushToAllMock.mockReset();
  sendPushToAllMock.mockResolvedValue(undefined);

  // Same re-apply for the task-complete write helper. Default impl
  // resolves immediately so the route's `.catch` chain doesn't
  // throw on `undefined`.
  writeTaskCompleteMessageMock.mockReset();
  writeTaskCompleteMessageMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeReq(body?: unknown, init: RequestInit = {}): Request {
  return new Request("http://localhost/api/prs/42/merge", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function makePRDetail(overrides: Record<string, unknown> = {}) {
  return {
    number: 42,
    title: "WARP/feat — title",
    body: "Validation Tier: STANDARD",
    branch: "WARP/feat-clean",
    baseBranch: "main",
    author: "bayuewalker",
    state: "open" as const,
    merged: false,
    mergeable: true,
    additions: 10,
    deletions: 1,
    changedFiles: 1,
    updatedAt: "2026-04-30T12:00:00Z",
    createdAt: "2026-04-29T12:00:00Z",
    url: "https://github.com/bayuewalker/walkermind-os/pull/42",
    headSha: "abc123",
    reviews: [],
    ...overrides,
  };
}

function gateOk() {
  evaluateMergeGatesMock.mockReturnValueOnce({
    ok: true,
    tier: "STANDARD",
    isSentinel: false,
    gates: {},
    ciStatus: "success",
    blockers: [],
  });
}

function gateBlocked(blockers: string[] = ["Validation Tier missing"]) {
  evaluateMergeGatesMock.mockReturnValueOnce({
    ok: false,
    tier: null,
    isSentinel: false,
    gates: { tierDeclared: false },
    ciStatus: "success",
    blockers,
  });
}

describe("POST /api/prs/[number]/merge — auth gate", () => {
  it("returns 403 forbidden when isAdminAllowed === false", async () => {
    isAdminAllowedMock.mockReturnValueOnce(false);
    const { POST } = await import("./route");

    const res = await POST(makeReq({}), { params: { number: "42" } });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(getPRDetailMock).not.toHaveBeenCalled();
    expect(mergePRMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/prs/[number]/merge — input validation", () => {
  it("returns 400 when number is not a positive integer", async () => {
    const { POST } = await import("./route");

    const res = await POST(makeReq({}), { params: { number: "abc" } });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "pr number must be a positive integer",
    });
    expect(getPRDetailMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_json on malformed JSON body", async () => {
    const { POST } = await import("./route");

    const req = new Request("http://localhost/api/prs/42/merge", {
      method: "POST",
      body: "{ this is not json",
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req, { params: { number: "42" } });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("accepts an empty body (sessionId is optional)", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    gateOk();
    mergePRMock.mockResolvedValueOnce({
      merged: true,
      sha: "mergesha",
      message: "ok",
    });
    const { POST } = await import("./route");

    const req = new Request("http://localhost/api/prs/42/merge", {
      method: "POST",
    });
    const res = await POST(req, { params: { number: "42" } });

    expect(res.status).toBe(200);
    // Audit row was inserted with session_id: null (no body sent).
    expect(supabaseInsertMock.mock.calls[0][0]).toMatchObject({
      session_id: null,
      action: "merge",
      verdict: "ok",
    });
  });
});

describe("POST /api/prs/[number]/merge — already-merged / closed", () => {
  it("returns 409 when the PR is already merged (no merge attempted)", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail({ state: "merged" }));
    const { POST } = await import("./route");

    const res = await POST(makeReq({}), { params: { number: "42" } });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "already merged",
      prNumber: 42,
      sha: null,
    });
    expect(mergePRMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the PR is closed (no merge attempted)", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail({ state: "closed" }));
    const { POST } = await import("./route");

    const res = await POST(makeReq({}), { params: { number: "42" } });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "PR is closed — cannot merge",
      prNumber: 42,
    });
    expect(mergePRMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/prs/[number]/merge — gate evaluation", () => {
  it("returns 409 HOLD when gates.ok === false and audits {action: hold, verdict: blocked}", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    gateBlocked(["Validation Tier missing", "Branch must start with WARP/"]);

    const { POST } = await import("./route");
    const res = await POST(makeReq({ sessionId: "sess-1" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      status: "HOLD",
      blockers: ["Validation Tier missing", "Branch must start with WARP/"],
      gates: { tierDeclared: false },
      tier: null,
    });
    expect(mergePRMock).not.toHaveBeenCalled();

    // Audit captures the blocker reason joined.
    expect(supabaseInsertMock).toHaveBeenCalledTimes(1);
    expect(supabaseInsertMock.mock.calls[0][0]).toEqual({
      session_id: "sess-1",
      pr_number: 42,
      action: "hold",
      verdict: "blocked",
      reason: "Validation Tier missing, Branch must start with WARP/",
    });
  });

  it("looks up paired-FORGE PR for SENTINEL PRs and forwards the resolved value", async () => {
    isSentinelPRMock.mockReturnValueOnce(true);
    findPairedForgePRMock.mockResolvedValueOnce({
      resolved: true,
      merged: false,
    });
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    gateBlocked(["WARP•SENTINEL — paired WARP•FORGE PR not yet merged"]);

    const { POST } = await import("./route");
    await POST(makeReq({}), { params: { number: "42" } });

    expect(findPairedForgePRMock).toHaveBeenCalledTimes(1);
    const opts = evaluateMergeGatesMock.mock.calls[0][2];
    expect(opts.forgePRMerged).toBe(false);
  });

  it("degrades a paired-FORGE lookup throw to forgePRMerged=null", async () => {
    isSentinelPRMock.mockReturnValueOnce(true);
    findPairedForgePRMock.mockRejectedValueOnce(new Error("lookup boom"));
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    gateBlocked();

    const { POST } = await import("./route");
    await POST(makeReq({}), { params: { number: "42" } });

    const opts = evaluateMergeGatesMock.mock.calls[0][2];
    expect(opts.forgePRMerged).toBe(null);
  });
});

describe("POST /api/prs/[number]/merge — success path", () => {
  it("returns 200 with the canonical shape and audits {action: merge, verdict: ok}", async () => {
    getPRDetailMock.mockResolvedValueOnce(
      makePRDetail({ branch: "WARP/cool-feat" }),
    );
    gateOk();
    mergePRMock.mockResolvedValueOnce({
      merged: true,
      sha: "deadbeef",
      message: "Squashed.",
    });

    const { POST } = await import("./route");
    const res = await POST(makeReq({ sessionId: "sess-7" }), {
      params: { number: "42" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      merged: true,
      sha: "deadbeef",
      prNumber: 42,
      branch: "WARP/cool-feat",
      postMergeReminder:
        "Post-merge sync required: update PROJECT_STATE.md + ROADMAP.md + WORKTODO.md + CHANGELOG.md for WARP/cool-feat",
    });
    expect(mergePRMock).toHaveBeenCalledWith(42, "cool-feat");
    expect(supabaseInsertMock.mock.calls[0][0]).toEqual({
      session_id: "sess-7",
      pr_number: 42,
      action: "merge",
      verdict: "ok",
      reason: null,
    });
  });

  it("succeeds even when the audit insert errors (best-effort)", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    gateOk();
    mergePRMock.mockResolvedValueOnce({
      merged: true,
      sha: "x",
      message: "ok",
    });
    supabaseInsertMock.mockResolvedValueOnce({
      error: { message: "supabase down" },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("./route");
    const res = await POST(makeReq({}), { params: { number: "42" } });

    expect(res.status).toBe(200);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("POST /api/prs/[number]/merge — error mapping", () => {
  it("maps `github_detail_404` to HTTP 404", async () => {
    getPRDetailMock.mockRejectedValueOnce(
      new Error("github_detail_404: Not Found"),
    );
    const { POST } = await import("./route");

    const res = await POST(makeReq({}), { params: { number: "42" } });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "github_detail_404: Not Found",
    });
    expect(mergePRMock).not.toHaveBeenCalled();
  });

  it("maps `github_detail_401` (Bad credentials) to HTTP 401", async () => {
    getPRDetailMock.mockRejectedValueOnce(
      new Error("github_detail_401: HttpError: Bad credentials"),
    );
    const { POST } = await import("./route");

    const res = await POST(makeReq({}), { params: { number: "42" } });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "github_detail_401: HttpError: Bad credentials",
    });
  });

  it("maps a `github_merge_403` (PAT scope) throw from mergePR to HTTP 403", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    gateOk();
    mergePRMock.mockRejectedValueOnce(
      new Error("github_merge_403: PAT missing pull_requests:write"),
    );

    const { POST } = await import("./route");
    const res = await POST(makeReq({}), { params: { number: "42" } });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "github_merge_403: PAT missing pull_requests:write",
    });
    // Merge failed → no audit insert.
    expect(supabaseInsertMock).not.toHaveBeenCalled();
  });

  it("maps a `github_merge_405` (not mergeable) throw to HTTP 405", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    gateOk();
    mergePRMock.mockRejectedValueOnce(
      new Error("github_merge_405: PR not mergeable"),
    );

    const { POST } = await import("./route");
    const res = await POST(makeReq({}), { params: { number: "42" } });

    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({
      error: "github_merge_405: PR not mergeable",
    });
  });

  it("maps a `github_merge_422` (validation) throw to HTTP 422", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    gateOk();
    mergePRMock.mockRejectedValueOnce(
      new Error("github_merge_422: HttpError: Validation Failed"),
    );

    const { POST } = await import("./route");
    const res = await POST(makeReq({}), { params: { number: "42" } });

    expect(res.status).toBe(422);
    expect(supabaseInsertMock).not.toHaveBeenCalled();
  });

  it("falls through to HTTP 500 for unrecognized merge status codes (e.g. 502)", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    gateOk();
    mergePRMock.mockRejectedValueOnce(
      new Error("github_merge_502: HttpError: gateway"),
    );

    const { POST } = await import("./route");
    const res = await POST(makeReq({}), { params: { number: "42" } });

    expect(res.status).toBe(500);
  });

  it("returns 500 when mergePR resolves with merged=false (GitHub said no)", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    gateOk();
    mergePRMock.mockResolvedValueOnce({
      merged: false,
      sha: "",
      message: "Branch protection rejected",
    });

    const { POST } = await import("./route");
    const res = await POST(makeReq({}), { params: { number: "42" } });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Branch protection rejected",
    });
    expect(supabaseInsertMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/prs/[number]/merge — push dispatch is non-blocking", () => {
  it("returns 200 even if sendPushToAll never resolves", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    gateOk();
    mergePRMock.mockResolvedValueOnce({
      merged: true,
      sha: "deadbeef",
      message: "merged",
    });

    // Push call returns a promise that NEVER resolves. If the route
    // awaited it, this test would hang and time out. The presence of
    // the `void` in the route lets the response return immediately.
    sendPushToAllMock.mockReturnValueOnce(new Promise(() => {}));

    const { POST } = await import("./route");
    const res = await POST(makeReq({}), { params: { number: "42" } });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.merged).toBe(true);
    expect(sendPushToAllMock).toHaveBeenCalledTimes(1);
  });

  it("returns 200 even if sendPushToAll rejects (defensive .catch absorbs)", async () => {
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());
    gateOk();
    mergePRMock.mockResolvedValueOnce({
      merged: true,
      sha: "deadbeef",
      message: "merged",
    });
    sendPushToAllMock.mockRejectedValueOnce(new Error("escaped"));

    const { POST } = await import("./route");
    const res = await POST(makeReq({}), { params: { number: "42" } });

    expect(res.status).toBe(200);
    expect((await res.json()).merged).toBe(true);
  });
});
