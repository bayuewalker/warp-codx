/**
 * Task #32 — Direct unit tests for the `github-prs` Octokit adapter.
 *
 * Mirrors the Task #31 strategy used in `./github.test.ts`:
 *   - Mock `@octokit/rest` at the *client* level. The mock constructor
 *     records the auth token it was given and exposes per-endpoint spies
 *     that each test programs.
 *   - The real `getClient()` caches the Octokit instance in a module-level
 *     `_client`, so we `vi.resetModules()` in `beforeEach` and dynamically
 *     re-import `./github-prs` per test. That also lets us toggle
 *     `GITHUB_PAT_CONSTITUTION` per case.
 *   - No real network calls. No real PAT.
 *
 * Coverage:
 *   - Success paths for `listWarpPRs`, `getPRDetail`, `mergePR`,
 *     `closePR`, `holdPR`, `findPairedForgePR`, `getPRCheckStatus`.
 *   - Error normalization (401 / 404 / 422 / 403-merge / 405-merge) into
 *     the `github_<op>_<status>: ...` contract.
 *   - Missing-PAT guard.
 *   - PAT / raw-error are never re-thrown to callers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pullsListMock = vi.fn();
const pullsGetMock = vi.fn();
const pullsMergeMock = vi.fn();
const pullsUpdateMock = vi.fn();
const pullsListReviewsMock = vi.fn();
const issuesCreateCommentMock = vi.fn();
const checksListForRefMock = vi.fn();
type OctokitConstructorCall = {
  auth?: string;
  requestFetch?: unknown;
};
const octokitConstructorCalls: OctokitConstructorCall[] = [];

vi.mock("@octokit/rest", () => {
  class OctokitMock {
    rest: {
      pulls: {
        list: typeof pullsListMock;
        get: typeof pullsGetMock;
        merge: typeof pullsMergeMock;
        update: typeof pullsUpdateMock;
        listReviews: typeof pullsListReviewsMock;
      };
      issues: { createComment: typeof issuesCreateCommentMock };
      checks: { listForRef: typeof checksListForRefMock };
    };
    constructor(
      opts: { auth?: string; request?: { fetch?: unknown } } = {},
    ) {
      octokitConstructorCalls.push({
        auth: opts.auth,
        requestFetch: opts.request?.fetch,
      });
      this.rest = {
        pulls: {
          list: pullsListMock,
          get: pullsGetMock,
          merge: pullsMergeMock,
          update: pullsUpdateMock,
          listReviews: pullsListReviewsMock,
        },
        issues: { createComment: issuesCreateCommentMock },
        checks: { listForRef: checksListForRefMock },
      };
    }
  }
  return { Octokit: OctokitMock };
});

const ORIGINAL_PAT = process.env.GITHUB_PAT_CONSTITUTION;

beforeEach(() => {
  vi.resetModules();
  pullsListMock.mockReset();
  pullsGetMock.mockReset();
  pullsMergeMock.mockReset();
  pullsUpdateMock.mockReset();
  pullsListReviewsMock.mockReset();
  issuesCreateCommentMock.mockReset();
  checksListForRefMock.mockReset();
  octokitConstructorCalls.length = 0;
  process.env.GITHUB_PAT_CONSTITUTION = "ghp_test_token_value";
});

afterEach(() => {
  if (ORIGINAL_PAT === undefined) {
    delete process.env.GITHUB_PAT_CONSTITUTION;
  } else {
    process.env.GITHUB_PAT_CONSTITUTION = ORIGINAL_PAT;
  }
});

// --- helpers ---------------------------------------------------------------

function makeOctokitError(status: number, message: string, name = "HttpError") {
  const err = new Error(message) as Error & {
    status?: number;
    response?: { headers: Record<string, string> };
  };
  err.name = name;
  err.status = status;
  // Octokit attaches request/response metadata that can echo the PAT
  // through the `authorization` header — we explicitly do NOT want this
  // re-thrown to callers.
  err.response = {
    headers: {
      authorization: "token ghp_test_token_value",
      "x-ratelimit-remaining": "0",
    },
  };
  return err;
}

function makePR(overrides: Record<string, unknown> = {}) {
  return {
    number: 101,
    title: "WARP/test-slug — example",
    body: "Validation Tier: STANDARD\n\nbody body",
    head: { ref: "WARP/test-slug", sha: "deadbeef" },
    base: { ref: "main" },
    user: { login: "bayuewalker" },
    state: "open",
    merged: false,
    mergeable: true,
    additions: 12,
    deletions: 3,
    changed_files: 2,
    updated_at: "2026-04-30T12:00:00Z",
    created_at: "2026-04-29T12:00:00Z",
    html_url: "https://github.com/bayuewalker/walkermind-os/pull/101",
    ...overrides,
  };
}

function makeOk<T>(data: T) {
  return { data, status: 200, url: "", headers: {} };
}

// --- listWarpPRs -----------------------------------------------------------

describe("listWarpPRs — success path", () => {
  it("filters to WARP/* head refs and returns the slim ListedPR shape", async () => {
    pullsListMock.mockResolvedValueOnce(
      makeOk([
        makePR({ number: 1, head: { ref: "WARP/foo", sha: "s1" } }),
        makePR({
          number: 2,
          head: { ref: "feature/bar", sha: "s2" },
          body: "Validation Tier: MINOR",
        }),
        makePR({
          number: 3,
          head: { ref: "WARP/baz-sentinel", sha: "s3" },
          body: "Validation Tier: MAJOR\n",
        }),
      ]),
    );

    const { listWarpPRs } = await import("./github-prs");
    const out = await listWarpPRs();

    expect(out.truncated).toBe(false);
    expect(out.prs).toHaveLength(2);
    expect(out.prs[0]).toMatchObject({
      number: 1,
      branch: "WARP/foo",
      author: "bayuewalker",
      tier: "STANDARD",
      state: "open",
    });
    expect(out.prs[1]).toMatchObject({
      number: 3,
      branch: "WARP/baz-sentinel",
      tier: "MAJOR",
    });
  });

  it("calls pulls.list with the canonical owner/repo and pagination args", async () => {
    pullsListMock.mockResolvedValueOnce(makeOk([]));

    const { listWarpPRs } = await import("./github-prs");
    await listWarpPRs();

    expect(pullsListMock).toHaveBeenCalledTimes(1);
    const arg = pullsListMock.mock.calls[0][0];
    expect(arg.owner).toBe("bayuewalker");
    expect(arg.repo).toBe("walkermind-os");
    expect(arg.state).toBe("open");
    expect(arg.per_page).toBe(100);
    expect(arg.page).toBe(1);
  });

  it("forwards the PAT into the Octokit constructor", async () => {
    pullsListMock.mockResolvedValueOnce(makeOk([]));

    const { listWarpPRs } = await import("./github-prs");
    await listWarpPRs();

    expect(octokitConstructorCalls).toHaveLength(1);
    expect(octokitConstructorCalls[0].auth).toBe("ghp_test_token_value");
  });

  it("returns truncated=true once the WARP cap is reached with more pages possible", async () => {
    // Build a single page of 100 PRs, all WARP/*. Cap is 30.
    const big = Array.from({ length: 100 }).map((_, i) =>
      makePR({ number: i + 1, head: { ref: `WARP/slug-${i}`, sha: `s${i}` } }),
    );
    pullsListMock.mockResolvedValueOnce(makeOk(big));

    const { listWarpPRs } = await import("./github-prs");
    const out = await listWarpPRs();

    expect(out.prs).toHaveLength(30);
    expect(out.truncated).toBe(true);
  });
});

describe("listWarpPRs — error normalization", () => {
  it("normalizes a 401 into `github_list_401: ...`", async () => {
    pullsListMock.mockRejectedValueOnce(makeOctokitError(401, "Bad credentials"));
    const { listWarpPRs } = await import("./github-prs");
    await expect(listWarpPRs()).rejects.toThrow(/^github_list_401:/);
  });

  it("normalizes a 404 into `github_list_404: ...`", async () => {
    pullsListMock.mockRejectedValueOnce(makeOctokitError(404, "Not Found"));
    const { listWarpPRs } = await import("./github-prs");
    await expect(listWarpPRs()).rejects.toThrow(/^github_list_404:/);
  });

  it("normalizes a 422 validation error into `github_list_422: ...`", async () => {
    pullsListMock.mockRejectedValueOnce(
      makeOctokitError(422, "Validation Failed"),
    );
    const { listWarpPRs } = await import("./github-prs");
    await expect(listWarpPRs()).rejects.toThrow(/^github_list_422:/);
  });
});

// --- getPRDetail -----------------------------------------------------------

describe("getPRDetail — success path", () => {
  it("returns the PRDetail shape including reviews and headSha", async () => {
    pullsGetMock.mockResolvedValueOnce(
      makeOk(makePR({ number: 42, head: { ref: "WARP/foo", sha: "abc123" } })),
    );
    pullsListReviewsMock.mockResolvedValueOnce(
      makeOk([
        {
          id: 9,
          user: { login: "reviewer" },
          state: "APPROVED",
          body: "lgtm",
          submitted_at: "2026-04-30T13:00:00Z",
        },
      ]),
    );

    const { getPRDetail } = await import("./github-prs");
    const out = await getPRDetail(42);

    expect(out).toMatchObject({
      number: 42,
      branch: "WARP/foo",
      baseBranch: "main",
      headSha: "abc123",
      state: "open",
      merged: false,
      mergeable: true,
      additions: 12,
      deletions: 3,
      changedFiles: 2,
    });
    expect(out.reviews).toHaveLength(1);
    expect(out.reviews[0]).toMatchObject({
      id: 9,
      user: "reviewer",
      state: "APPROVED",
    });
  });

  it("classifies a merged PR as state=merged", async () => {
    pullsGetMock.mockResolvedValueOnce(
      makeOk(makePR({ merged: true, state: "closed" })),
    );
    pullsListReviewsMock.mockResolvedValueOnce(makeOk([]));

    const { getPRDetail } = await import("./github-prs");
    const out = await getPRDetail(7);

    expect(out.state).toBe("merged");
    expect(out.merged).toBe(true);
  });
});

describe("getPRDetail — error normalization", () => {
  it("normalizes a 404 into `github_detail_404: ...`", async () => {
    pullsGetMock.mockRejectedValueOnce(makeOctokitError(404, "Not Found"));
    pullsListReviewsMock.mockResolvedValueOnce(makeOk([]));

    const { getPRDetail } = await import("./github-prs");
    await expect(getPRDetail(123)).rejects.toThrow(/^github_detail_404:/);
  });

  it("normalizes a 401 into `github_detail_401: ...`", async () => {
    pullsGetMock.mockRejectedValueOnce(
      makeOctokitError(401, "Bad credentials"),
    );
    pullsListReviewsMock.mockResolvedValueOnce(makeOk([]));

    const { getPRDetail } = await import("./github-prs");
    await expect(getPRDetail(123)).rejects.toThrow(/^github_detail_401:/);
  });
});

// --- mergePR ---------------------------------------------------------------

describe("mergePR — success path", () => {
  it("squash-merges with the canonical commit title and returns MergeOutcome", async () => {
    pullsMergeMock.mockResolvedValueOnce(
      makeOk({ merged: true, sha: "mergesha", message: "Squashed and merged." }),
    );

    const { mergePR } = await import("./github-prs");
    const out = await mergePR(55, "test-slug");

    expect(out).toEqual({
      merged: true,
      sha: "mergesha",
      message: "Squashed and merged.",
    });
    const arg = pullsMergeMock.mock.calls[0][0];
    expect(arg.owner).toBe("bayuewalker");
    expect(arg.repo).toBe("walkermind-os");
    expect(arg.pull_number).toBe(55);
    expect(arg.merge_method).toBe("squash");
    expect(arg.commit_title).toBe("Merged WARP/test-slug via WARP CodX");
  });
});

describe("mergePR — error normalization", () => {
  it("special-cases 403 to a PAT-scope hint", async () => {
    pullsMergeMock.mockRejectedValueOnce(makeOctokitError(403, "Forbidden"));
    const { mergePR } = await import("./github-prs");
    await expect(mergePR(1, "x")).rejects.toThrow(
      /^github_merge_403: PAT missing pull_requests:write/,
    );
  });

  it("special-cases 405 to a 'PR not mergeable' hint", async () => {
    pullsMergeMock.mockRejectedValueOnce(
      makeOctokitError(405, "Method Not Allowed"),
    );
    const { mergePR } = await import("./github-prs");
    await expect(mergePR(1, "x")).rejects.toThrow(
      /^github_merge_405: PR not mergeable/,
    );
  });

  it("normalizes a 422 validation error into `github_merge_422: ...`", async () => {
    pullsMergeMock.mockRejectedValueOnce(
      makeOctokitError(422, "Validation Failed"),
    );
    const { mergePR } = await import("./github-prs");
    await expect(mergePR(1, "x")).rejects.toThrow(/^github_merge_422:/);
  });

  it("normalizes a 404 into `github_merge_404: ...`", async () => {
    pullsMergeMock.mockRejectedValueOnce(makeOctokitError(404, "Not Found"));
    const { mergePR } = await import("./github-prs");
    await expect(mergePR(1, "x")).rejects.toThrow(/^github_merge_404:/);
  });
});

// --- closePR ---------------------------------------------------------------

describe("closePR — success path", () => {
  it("posts a comment then closes; returns commentPosted=true", async () => {
    issuesCreateCommentMock.mockResolvedValueOnce(makeOk({ id: 1 }));
    pullsUpdateMock.mockResolvedValueOnce(makeOk(makePR({ state: "closed" })));

    const { closePR } = await import("./github-prs");
    const out = await closePR(7, "ship-blocker");

    expect(out).toEqual({ closed: true, commentPosted: true });
    expect(issuesCreateCommentMock).toHaveBeenCalledTimes(1);
    expect(issuesCreateCommentMock.mock.calls[0][0].body).toContain(
      "WARP🔹CMD close",
    );
    expect(pullsUpdateMock.mock.calls[0][0].state).toBe("closed");
  });

  it("still closes when the comment fails (returns commentPosted=false)", async () => {
    issuesCreateCommentMock.mockRejectedValueOnce(
      makeOctokitError(500, "boom"),
    );
    pullsUpdateMock.mockResolvedValueOnce(makeOk(makePR({ state: "closed" })));

    const { closePR } = await import("./github-prs");
    const out = await closePR(7, "ship-blocker");

    expect(out).toEqual({ closed: true, commentPosted: false });
  });

  it("skips the comment call when reason is empty", async () => {
    pullsUpdateMock.mockResolvedValueOnce(makeOk(makePR({ state: "closed" })));

    const { closePR } = await import("./github-prs");
    const out = await closePR(7, "   ");

    expect(out).toEqual({ closed: true, commentPosted: false });
    expect(issuesCreateCommentMock).not.toHaveBeenCalled();
  });
});

describe("closePR — error normalization", () => {
  it("normalizes update 404 into `github_close_404: ...`", async () => {
    pullsUpdateMock.mockRejectedValueOnce(makeOctokitError(404, "Not Found"));

    const { closePR } = await import("./github-prs");
    await expect(closePR(7, "")).rejects.toThrow(/^github_close_404:/);
  });

  it("normalizes update 422 into `github_close_422: ...`", async () => {
    pullsUpdateMock.mockRejectedValueOnce(
      makeOctokitError(422, "Validation Failed"),
    );
    const { closePR } = await import("./github-prs");
    await expect(closePR(7, "")).rejects.toThrow(/^github_close_422:/);
  });
});

// --- holdPR ----------------------------------------------------------------

describe("holdPR — success + error normalization", () => {
  it("posts a `WARP🔹CMD hold` comment and returns commentPosted=true", async () => {
    issuesCreateCommentMock.mockResolvedValueOnce(makeOk({ id: 5 }));

    const { holdPR } = await import("./github-prs");
    const out = await holdPR(11, "needs review");

    expect(out).toEqual({ commentPosted: true });
    const arg = issuesCreateCommentMock.mock.calls[0][0];
    expect(arg.issue_number).toBe(11);
    expect(arg.body).toBe("**WARP🔹CMD hold** — needs review");
  });

  it("normalizes a 401 into `github_hold_401: ...`", async () => {
    issuesCreateCommentMock.mockRejectedValueOnce(
      makeOctokitError(401, "Bad credentials"),
    );
    const { holdPR } = await import("./github-prs");
    await expect(holdPR(11, "x")).rejects.toThrow(/^github_hold_401:/);
  });

  it("normalizes a 404 into `github_hold_404: ...`", async () => {
    issuesCreateCommentMock.mockRejectedValueOnce(
      makeOctokitError(404, "Not Found"),
    );
    const { holdPR } = await import("./github-prs");
    await expect(holdPR(11, "x")).rejects.toThrow(/^github_hold_404:/);
  });
});

// --- findPairedForgePR -----------------------------------------------------

describe("findPairedForgePR", () => {
  it("resolves via branch convention WARP/<slug>-sentinel → WARP/<slug>", async () => {
    pullsListMock.mockResolvedValueOnce(
      makeOk([{ ...makePR({ number: 9 }), merged_at: "2026-04-30T01:00:00Z" }]),
    );

    const { findPairedForgePR } = await import("./github-prs");
    const out = await findPairedForgePR({
      branch: "WARP/cool-thing-sentinel",
      body: "",
    });

    expect(out.resolved).toBe(true);
    expect(out.merged).toBe(true);
    expect(out.attemptedRefs).toContain("WARP/cool-thing");
    const arg = pullsListMock.mock.calls[0][0];
    expect(arg.head).toBe("bayuewalker:WARP/cool-thing");
  });

  it("returns resolved=true, merged=false when paired PR exists but isn't merged", async () => {
    pullsListMock.mockResolvedValueOnce(
      makeOk([{ ...makePR({ number: 9 }), merged_at: null }]),
    );

    const { findPairedForgePR } = await import("./github-prs");
    const out = await findPairedForgePR({
      branch: "WARP/x-sentinel",
      body: "",
    });

    expect(out.resolved).toBe(true);
    expect(out.merged).toBe(false);
  });

  it("returns resolved=false when no candidate ref matches", async () => {
    const { findPairedForgePR } = await import("./github-prs");
    // No `-sentinel` suffix and no `Pairs:` line → no candidates derived.
    const out = await findPairedForgePR({
      branch: "WARP/standalone",
      body: "",
    });

    expect(out.resolved).toBe(false);
    expect(out.merged).toBe(false);
    expect(pullsListMock).not.toHaveBeenCalled();
    expect(pullsGetMock).not.toHaveBeenCalled();
  });

  it("ignores a bare `Pairs: #N` body line when no convention/ref hint backs it up", async () => {
    const { findPairedForgePR } = await import("./github-prs");
    const out = await findPairedForgePR({
      branch: "WARP/standalone",
      body: "Pairs: #42",
    });

    expect(out.resolved).toBe(false);
    expect(pullsGetMock).not.toHaveBeenCalled();
  });

  it("trusts `Pairs: #N` only when the resolved head ref matches a candidate", async () => {
    pullsGetMock.mockResolvedValueOnce(
      makeOk(
        makePR({ number: 42, head: { ref: "WARP/feature", sha: "s" }, merged: true }),
      ),
    );

    const { findPairedForgePR } = await import("./github-prs");
    const out = await findPairedForgePR({
      branch: "WARP/feature-sentinel",
      body: "Pairs: #42",
    });

    expect(out.resolved).toBe(true);
    expect(out.merged).toBe(true);
    expect(pullsGetMock).toHaveBeenCalledTimes(1);
  });
});

// --- getPRCheckStatus ------------------------------------------------------

describe("getPRCheckStatus", () => {
  it("returns 'success' when the latest run concluded success", async () => {
    checksListForRefMock.mockResolvedValueOnce(
      makeOk({
        check_runs: [{ status: "completed", conclusion: "success" }],
      }),
    );
    const { getPRCheckStatus } = await import("./github-prs");
    expect(await getPRCheckStatus("sha", "test")).toBe("success");
  });

  it("returns 'pending' when the latest run is queued/in_progress", async () => {
    checksListForRefMock.mockResolvedValueOnce(
      makeOk({ check_runs: [{ status: "in_progress", conclusion: null }] }),
    );
    const { getPRCheckStatus } = await import("./github-prs");
    expect(await getPRCheckStatus("sha", "test")).toBe("pending");
  });

  it("returns 'failure' for non-success conclusions", async () => {
    checksListForRefMock.mockResolvedValueOnce(
      makeOk({ check_runs: [{ status: "completed", conclusion: "failure" }] }),
    );
    const { getPRCheckStatus } = await import("./github-prs");
    expect(await getPRCheckStatus("sha", "test")).toBe("failure");
  });

  it("returns 'missing' for an empty check_runs list", async () => {
    checksListForRefMock.mockResolvedValueOnce(makeOk({ check_runs: [] }));
    const { getPRCheckStatus } = await import("./github-prs");
    expect(await getPRCheckStatus("sha", "test")).toBe("missing");
  });

  it("returns 'missing' when headSha is empty (no Octokit call)", async () => {
    const { getPRCheckStatus } = await import("./github-prs");
    expect(await getPRCheckStatus("", "test")).toBe("missing");
    expect(checksListForRefMock).not.toHaveBeenCalled();
  });

  it("degrades to 'missing' on Octokit error rather than throwing", async () => {
    checksListForRefMock.mockRejectedValueOnce(
      makeOctokitError(500, "Internal Server Error"),
    );
    const { getPRCheckStatus } = await import("./github-prs");
    expect(await getPRCheckStatus("sha", "test")).toBe("missing");
  });
});

// --- environment + safety guards ------------------------------------------

describe("github-prs — environment + safety guards", () => {
  it("throws a descriptive error when GITHUB_PAT_CONSTITUTION is missing", async () => {
    delete process.env.GITHUB_PAT_CONSTITUTION;

    const { listWarpPRs } = await import("./github-prs");
    await expect(listWarpPRs()).rejects.toThrow(
      /GITHUB_PAT_CONSTITUTION env var is not set/,
    );
    // No Octokit was constructed and no network call was made.
    expect(octokitConstructorCalls).toHaveLength(0);
    expect(pullsListMock).not.toHaveBeenCalled();
  });

  it("never re-throws the raw Octokit error (no auth header leak)", async () => {
    const raw = makeOctokitError(401, "Bad credentials");
    pullsListMock.mockRejectedValueOnce(raw);

    const { listWarpPRs } = await import("./github-prs");
    let caught: unknown;
    try {
      await listWarpPRs();
    } catch (e) {
      caught = e;
    }

    expect(caught).not.toBe(raw);
    expect((caught as { response?: unknown }).response).toBeUndefined();
    expect((caught as Error).message).not.toContain("ghp_test_token_value");
  });

  it("caches the Octokit client across calls within the same module load", async () => {
    pullsListMock.mockResolvedValue(makeOk([]));

    const { listWarpPRs } = await import("./github-prs");
    await listWarpPRs();
    await listWarpPRs();

    // Two listWarpPRs calls → two pulls.list calls → one Octokit construction.
    expect(pullsListMock).toHaveBeenCalledTimes(2);
    expect(octokitConstructorCalls).toHaveLength(1);
  });

  // Regression: Next.js 14 monkey-patches the global `fetch` to add a
  // data cache keyed by URL only (NOT by Authorization header). Octokit
  // v22 uses native `fetch`, so without an explicit cache-bypass wrapper
  // the very first GitHub list response gets pinned in Next's cache and
  // re-served on every later call — the symptom that surfaced in the
  // chat hub was `/api/prs/list` returning `{prs:[],truncated:false}`
  // even though an open WARP/* PR existed on the remote repo.
  it("constructs Octokit with a custom fetch that disables Next.js's data cache", async () => {
    pullsListMock.mockResolvedValueOnce(makeOk([]));

    const { listWarpPRs } = await import("./github-prs");
    await listWarpPRs();

    expect(octokitConstructorCalls).toHaveLength(1);
    const requestFetch = octokitConstructorCalls[0].requestFetch;
    expect(typeof requestFetch).toBe("function");

    // Capture the init arg the wrapper forwards to the global fetch and
    // assert both Next-cache-bypass keys are set.
    const realFetch = globalThis.fetch;
    const fetchSpy = vi.fn(
      async (
        _input: RequestInfo | URL,
        _init?: RequestInit,
      ): Promise<Response> =>
        new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await (
        requestFetch as (
          input: RequestInfo | URL,
          init?: RequestInit,
        ) => Promise<Response>
      )("https://api.github.com/test", { headers: { x: "y" } });
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const forwardedInit = fetchSpy.mock.calls[0][1] as unknown as RequestInit & {
      next?: { revalidate?: number };
    };
    expect(forwardedInit.cache).toBe("no-store");
    // Note: do NOT also set `next: { revalidate: 0 }` — Next.js logs a
    // runtime warning when both cache:"no-store" and revalidate:0 are
    // specified on the same request. cache:"no-store" alone is enough.
    expect(forwardedInit.next).toBeUndefined();
    // Caller-provided init keys must still be forwarded.
    expect((forwardedInit.headers as Record<string, string>).x).toBe("y");
  });
});
