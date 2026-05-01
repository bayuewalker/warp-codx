/**
 * Task #35 — Direct route tests for `GET /api/prs/[number]`.
 *
 * Covers the route layer that wraps the `github-prs` adapter:
 *   - production-debug auth gate
 *   - request-param validation (`number` must be a positive integer)
 *   - SENTINEL → paired-FORGE branch (lookup performed only when
 *     `isSentinelPR` returns true; lookup failures degrade to null)
 *   - CI status forwarded into the gate evaluator
 *   - successful 200 response shape (pr / gates / postMergeReminder)
 *   - 404 mapping for `github_detail_404`, 500 mapping for everything
 *     else
 *
 * `@/lib/github-prs`, `@/lib/pr-gates`, and `@/lib/adminGate` are
 * mocked so this exercises ONLY the route handler — the adapter and
 * the gate evaluator each have their own test files.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPRDetailMock = vi.fn();
const findPairedForgePRMock = vi.fn();
const getPRCheckStatusMock = vi.fn();
const evaluateMergeGatesMock = vi.fn();
const isSentinelPRMock = vi.fn();
const isAdminAllowedMock = vi.fn();

vi.mock("@/lib/github-prs", () => ({
  getPRDetail: getPRDetailMock,
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

beforeEach(() => {
  getPRDetailMock.mockReset();
  findPairedForgePRMock.mockReset();
  getPRCheckStatusMock.mockReset();
  evaluateMergeGatesMock.mockReset();
  isSentinelPRMock.mockReset();
  isAdminAllowedMock.mockReset();
  // Defaults: admin allowed, PR is non-sentinel, CI is success, gate ok.
  isAdminAllowedMock.mockReturnValue(true);
  isSentinelPRMock.mockReturnValue(false);
  getPRCheckStatusMock.mockResolvedValue("success");
  evaluateMergeGatesMock.mockReturnValue({
    ok: true,
    tier: "STANDARD",
    isSentinel: false,
    gates: {},
    ciStatus: "success",
    blockers: [],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeReq(): Request {
  return new Request("http://localhost/api/prs/42");
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

describe("GET /api/prs/[number] — auth gate", () => {
  it("returns 403 forbidden when isAdminAllowed === false", async () => {
    isAdminAllowedMock.mockReturnValueOnce(false);
    const { GET } = await import("./route");

    const res = await GET(makeReq(), { params: { number: "42" } });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(getPRDetailMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/prs/[number] — param validation", () => {
  it("returns 400 when the number param is not a positive integer", async () => {
    const { GET } = await import("./route");

    // Note: `parseInt` is lax — "1.5" parses to 1 and is accepted, so
    // we don't list it. Pure non-integers + non-positive cases only.
    for (const bad of ["abc", "0", "-1", ""]) {
      const res = await GET(makeReq(), { params: { number: bad } });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "pr number must be a positive integer",
      });
    }
    expect(getPRDetailMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/prs/[number] — success path", () => {
  it("returns 200 with { pr, gates, postMergeReminder } for a non-sentinel PR", async () => {
    const pr = makePRDetail();
    getPRDetailMock.mockResolvedValueOnce(pr);
    const gates = {
      ok: true,
      tier: "STANDARD",
      isSentinel: false,
      gates: { tierDeclared: true },
      ciStatus: "success",
      blockers: [],
    };
    evaluateMergeGatesMock.mockReturnValueOnce(gates);

    const { GET } = await import("./route");
    const res = await GET(makeReq(), { params: { number: "42" } });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pr).toEqual(pr);
    expect(body.gates).toEqual(gates);
    expect(body.postMergeReminder).toBe(
      "Post-merge sync required: update PROJECT_STATE.md + ROADMAP.md + WORKTODO.md + CHANGELOG.md for WARP/feat-clean",
    );

    // Non-sentinel PR → no paired-FORGE lookup.
    expect(findPairedForgePRMock).not.toHaveBeenCalled();
    // CI status is always queried so the card mirrors the merge route.
    expect(getPRCheckStatusMock).toHaveBeenCalledWith("abc123");
    // Gate evaluator was given forgePRMerged=null (non-sentinel) + the CI status.
    const gateOpts = evaluateMergeGatesMock.mock.calls[0][2];
    expect(gateOpts).toEqual({ forgePRMerged: null, ciStatus: "success" });
  });

  it("performs the paired-FORGE lookup for a SENTINEL PR and forwards merged=true", async () => {
    isSentinelPRMock.mockReturnValueOnce(true);
    findPairedForgePRMock.mockResolvedValueOnce({
      resolved: true,
      merged: true,
    });
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());

    const { GET } = await import("./route");
    await GET(makeReq(), { params: { number: "42" } });

    expect(findPairedForgePRMock).toHaveBeenCalledTimes(1);
    const opts = evaluateMergeGatesMock.mock.calls[0][2];
    expect(opts.forgePRMerged).toBe(true);
  });

  it("degrades a paired-FORGE lookup throw to forgePRMerged=null without 500ing", async () => {
    isSentinelPRMock.mockReturnValueOnce(true);
    findPairedForgePRMock.mockRejectedValueOnce(
      new Error("github_list_500: lookup blew up"),
    );
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());

    const { GET } = await import("./route");
    const res = await GET(makeReq(), { params: { number: "42" } });

    expect(res.status).toBe(200);
    const opts = evaluateMergeGatesMock.mock.calls[0][2];
    expect(opts.forgePRMerged).toBe(null);
  });

  it("forwards an unresolved paired-FORGE lookup as forgePRMerged=null", async () => {
    isSentinelPRMock.mockReturnValueOnce(true);
    findPairedForgePRMock.mockResolvedValueOnce({
      resolved: false,
      merged: false,
    });
    getPRDetailMock.mockResolvedValueOnce(makePRDetail());

    const { GET } = await import("./route");
    await GET(makeReq(), { params: { number: "42" } });

    const opts = evaluateMergeGatesMock.mock.calls[0][2];
    expect(opts.forgePRMerged).toBe(null);
  });
});

describe("GET /api/prs/[number] — error mapping", () => {
  it("maps a `github_detail_404` adapter error to HTTP 404", async () => {
    getPRDetailMock.mockRejectedValueOnce(
      new Error("github_detail_404: Not Found"),
    );
    const { GET } = await import("./route");

    const res = await GET(makeReq(), { params: { number: "42" } });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "github_detail_404: Not Found",
    });
  });

  it("maps `github_detail_401` (Bad credentials) to HTTP 401", async () => {
    getPRDetailMock.mockRejectedValueOnce(
      new Error("github_detail_401: HttpError: Bad credentials"),
    );
    const { GET } = await import("./route");

    const res = await GET(makeReq(), { params: { number: "42" } });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "github_detail_401: HttpError: Bad credentials",
    });
  });

  it("maps `github_detail_422` (Validation Failed) to HTTP 422", async () => {
    getPRDetailMock.mockRejectedValueOnce(
      new Error("github_detail_422: HttpError: Validation Failed"),
    );
    const { GET } = await import("./route");

    const res = await GET(makeReq(), { params: { number: "42" } });

    expect(res.status).toBe(422);
  });

  it("falls through to HTTP 500 for unrecognized status codes (e.g. 500)", async () => {
    getPRDetailMock.mockRejectedValueOnce(
      new Error("github_detail_500: HttpError: boom"),
    );
    const { GET } = await import("./route");

    const res = await GET(makeReq(), { params: { number: "42" } });

    expect(res.status).toBe(500);
  });

  it("maps a non-Error throw to a generic fallback at 500", async () => {
    getPRDetailMock.mockRejectedValueOnce("boom-string-not-error");
    const { GET } = await import("./route");

    const res = await GET(makeReq(), { params: { number: "42" } });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "github detail failed" });
  });
});
