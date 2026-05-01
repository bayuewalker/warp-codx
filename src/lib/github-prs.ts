/**
 * Phase 3c — Octokit wrapper for GitHub Pull Request operations on the
 * `bayuewalker/walkermind-os` repo.
 *
 * Kept deliberately separate from `src/lib/github.ts` (Phase 3a
 * constitution-fetch) and `src/lib/github-issues.ts` (Phase 3b issue
 * creation) per the hard constraint of not touching prior-phase code.
 *
 * All three modules share the same PAT (`GITHUB_PAT_CONSTITUTION`,
 * scopes now include `Pull requests: Read and write` per dispatch
 * pre-req) but instantiate independent lazy Octokit clients.
 *
 * SECURITY:
 *   - PAT read once at first use, never logged, returned, or persisted.
 *   - Octokit-thrown errors carry the auth header in
 *     `error.response.headers`; we always re-throw a sanitized
 *     `github_<op>_<status>: <name>: <message>` string instead of the
 *     raw error object.
 *   - For PAT-scope drift (403 on the merge call) we surface a
 *     specific actionable message so Mr. Walker can re-grant scope.
 */
import { Octokit } from "@octokit/rest";
import type { CiStatus } from "./pr-gates";

const REPO_OWNER = "bayuewalker";
const REPO_NAME = "walkermind-os";

export const PRS_REPO = { owner: REPO_OWNER, name: REPO_NAME } as const;

let _client: Octokit | null = null;

/**
 * Custom fetch passed to Octokit.
 *
 * WHY: Next.js 14's App Router monkey-patches the global `fetch` to add
 * its own data cache. Octokit v22+ uses native `fetch` under the hood,
 * so without this wrapper every Octokit call to GitHub gets cached by
 * URL only (Authorization header is not part of the cache key).
 *
 * Symptom we hit: `pulls.list` returned 0 PRs forever even when GitHub
 * actually had open WARP/* PRs — a stale "0 results" response from an
 * earlier call (different PAT scope, or before any PR existed) was
 * pinned in Next's data cache and re-served on every subsequent call.
 *
 * `cache: "no-store"` opts every Octokit request out of Next's fetch
 * cache so we always hit api.github.com directly. (Specifying both
 * `cache: "no-store"` and `next: { revalidate: 0 }` triggers a Next
 * runtime warning — only one should be set.)
 */
const octokitNoCacheFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    cache: "no-store",
  });

function getClient(): Octokit {
  if (_client) return _client;
  const token = process.env.GITHUB_PAT_CONSTITUTION;
  if (!token) {
    throw new Error(
      "github-prs: GITHUB_PAT_CONSTITUTION env var is not set",
    );
  }
  _client = new Octokit({
    auth: token,
    request: {
      // 10s — merge can be slightly slower than create/list. Still
      // fail fast so the chat UI doesn't hang.
      timeout: 10_000,
      fetch: octokitNoCacheFetch,
    },
  });
  return _client;
}

/** Slim PR shape returned to the chat surface. */
export type ListedPR = {
  number: number;
  title: string;
  branch: string;
  author: string;
  /** Parsed from PR body via the same regex as pr-gates.ts. */
  tier: "MINOR" | "STANDARD" | "MAJOR" | null;
  additions: number;
  deletions: number;
  updatedAt: string;
  url: string;
  state: "open" | "closed";
};

const TIER_RE = /^\s*Validation Tier:\s*(MINOR|STANDARD|MAJOR)\b/im;
function parseTier(body: string | null | undefined): ListedPR["tier"] {
  if (!body) return null;
  const m = body.match(TIER_RE);
  if (!m) return null;
  const v = m[1].toUpperCase();
  return v === "MINOR" || v === "STANDARD" || v === "MAJOR" ? v : null;
}

/** Hard cap on WARP PRs returned (matches PR_LIST_MAX in the UI). */
const WARP_LIST_LIMIT = 30;
/** Safety bound on pagination: stop after this many list pages even if
 *  we haven't filled WARP_LIST_LIMIT, to keep the PAT call budget sane. */
const WARP_LIST_MAX_PAGES = 5;

/**
 * List open PRs whose head branch starts with `WARP/`. Paginates over
 * `pulls.list` (per_page=100) collecting WARP/* matches until we hit
 * WARP_LIST_LIMIT or exhaust open PRs (or reach WARP_LIST_MAX_PAGES).
 *
 * `truncated=true` only when there were definitively more WARP/* PRs
 * we did not return — i.e. we hit WARP_LIST_LIMIT and there is at
 * least one more open PR page that could contain WARP matches.
 *
 * Per Risk #5: at the cap the UI shows a "showing 30 of N+" footer.
 */
export async function listWarpPRs(): Promise<{
  prs: ListedPR[];
  truncated: boolean;
}> {
  const octokit = getClient();
  const collected: ListedPR[] = [];
  let truncated = false;
  try {
    for (let page = 1; page <= WARP_LIST_MAX_PAGES; page++) {
      const res = await octokit.rest.pulls.list({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        state: "open",
        sort: "updated",
        direction: "desc",
        per_page: 100,
        page,
      });
      const data = res.data;
      for (const pr of data) {
        if (
          typeof pr.head?.ref === "string" &&
          pr.head.ref.startsWith("WARP/")
        ) {
          collected.push({
            number: pr.number,
            title: pr.title,
            branch: pr.head.ref,
            author: pr.user?.login ?? "unknown",
            tier: parseTier(pr.body),
            // additions/deletions not provided by list endpoint.
            additions: 0,
            deletions: 0,
            updatedAt: pr.updated_at,
            url: pr.html_url,
            state: (pr.state === "closed" ? "closed" : "open") as
              | "open"
              | "closed",
          });
          if (collected.length >= WARP_LIST_LIMIT) {
            // We hit the cap. Truncated iff there are more pages OR
            // more items in the current page after this match.
            const idx = data.indexOf(pr);
            truncated = idx < data.length - 1 || data.length === 100;
            return { prs: collected, truncated };
          }
        }
      }
      // End of pagination: fewer than per_page means no more pages.
      if (data.length < 100) {
        return { prs: collected, truncated: false };
      }
      // We exhausted this page without filling cap — continue.
    }
    // We hit the page-budget bound without filling the cap. Mark
    // truncated so the UI hints there could be more.
    return { prs: collected, truncated: true };
  } catch (err: unknown) {
    throw sanitize(err, "list");
  }
}

/** Detailed PR + reviews for the PRCard's expanded state and the merge gate. */
export type PRDetail = {
  number: number;
  title: string;
  body: string;
  branch: string;
  baseBranch: string;
  author: string;
  state: "open" | "closed" | "merged";
  merged: boolean;
  mergeable: boolean | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  updatedAt: string;
  createdAt: string;
  url: string;
  /**
   * SHA of the PR head commit. Surfaced so the merge / detail routes
   * can look up the CI check-run conclusion against this exact commit
   * (Task #30 — see `getPRCheckStatus`).
   */
  headSha: string;
  reviews: Array<{
    id: number;
    user: string;
    state: string;
    body: string;
    submittedAt: string | null;
  }>;
};

export async function getPRDetail(prNumber: number): Promise<PRDetail> {
  const octokit = getClient();
  try {
    const [prRes, reviewsRes] = await Promise.all([
      octokit.rest.pulls.get({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        pull_number: prNumber,
      }),
      octokit.rest.pulls.listReviews({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        pull_number: prNumber,
        per_page: 100,
      }),
    ]);
    const pr = prRes.data;
    return {
      number: pr.number,
      title: pr.title,
      body: pr.body ?? "",
      branch: pr.head.ref,
      baseBranch: pr.base.ref,
      author: pr.user?.login ?? "unknown",
      state: pr.merged
        ? "merged"
        : pr.state === "closed"
          ? "closed"
          : "open",
      merged: !!pr.merged,
      mergeable: pr.mergeable ?? null,
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
      changedFiles: pr.changed_files ?? 0,
      updatedAt: pr.updated_at,
      createdAt: pr.created_at,
      url: pr.html_url,
      headSha: pr.head?.sha ?? "",
      reviews: reviewsRes.data.map((r) => ({
        id: r.id,
        user: r.user?.login ?? "unknown",
        state: r.state,
        body: r.body ?? "",
        submittedAt: r.submitted_at ?? null,
      })),
    };
  } catch (err: unknown) {
    throw sanitize(err, "detail");
  }
}

export type MergeOutcome = {
  merged: boolean;
  sha: string;
  message: string;
};

/**
 * Squash-merge the given PR. The caller (merge route) is responsible
 * for re-running pr-gates.evaluateMergeGates BEFORE invoking this; this
 * function just executes the merge.
 *
 * `branchSlug` is parsed from `pr.head.ref` (after the `WARP/` prefix)
 * and used to compose the commit title verbatim per spec.
 */
export async function mergePR(
  prNumber: number,
  branchSlug: string,
): Promise<MergeOutcome> {
  const octokit = getClient();
  try {
    const res = await octokit.rest.pulls.merge({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      pull_number: prNumber,
      merge_method: "squash",
      commit_title: `Merged WARP/${branchSlug} via WARP CodX`,
    });
    return {
      merged: !!res.data.merged,
      sha: res.data.sha,
      message: res.data.message,
    };
  } catch (err: unknown) {
    throw sanitize(err, "merge");
  }
}

/**
 * Phase 3c gate hardening (G3) — Post a "manual hold" comment on the
 * PR. Does NOT change the PR state on GitHub (HOLD is a soft pause,
 * not a close). Used by the `/api/prs/[number]/hold` route after the
 * operator confirms a manual hold from the PRCard.
 */
export async function holdPR(
  prNumber: number,
  reason: string,
): Promise<{ commentPosted: boolean }> {
  const octokit = getClient();
  try {
    await octokit.rest.issues.createComment({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      issue_number: prNumber,
      body: `**WARP🔹CMD hold** — ${reason.trim()}`,
    });
    return { commentPosted: true };
  } catch (err: unknown) {
    throw sanitize(err, "hold");
  }
}

/**
 * Phase 3c gate hardening (G1) — Result of resolving the WARP•FORGE PR
 * paired with a WARP•SENTINEL PR.
 *
 *   resolved=true,  merged=true   → paired FORGE PR is merged → gate passes
 *   resolved=true,  merged=false  → paired PR exists but isn't merged → gate fails
 *   resolved=false                → no candidate ref matched → gate fails
 *                                  (caller surfaces a distinct blocker string)
 */
export type PairedForgeLookup = {
  resolved: boolean;
  merged: boolean;
  attemptedRefs: string[];
};

const PAIRS_LINE_RE = /^\s*Pairs:\s*(\S.*)$/im;
const PAIRS_NUMBER_RE = /^\s*Pairs:\s*(?:PR\s*)?#(\d+)\b/im;

/** Derive candidate WARP/* head refs from the SENTINEL PR's branch + body. */
function deriveCandidatePairs(branch: string, body: string): string[] {
  const set: string[] = [];
  // 1. Body may declare an explicit `Pairs:` line. We accept either
  //    `Pairs: WARP/<slug>` (a head ref) or `Pairs: #N` (a PR number,
  //    handled separately by the caller). Take the first whitespace-
  //    separated token after the colon.
  const m = body.match(PAIRS_LINE_RE);
  if (m) {
    const tok = m[1].trim().split(/\s+/)[0];
    if (tok.startsWith("WARP/")) set.push(tok);
  }
  // 2. Convention-derived pairing: `WARP/<slug>-sentinel` pairs with
  //    `WARP/<slug>` and `WARP/<slug>-forge`.
  if (branch.endsWith("-sentinel")) {
    const base = branch.slice(0, -"-sentinel".length);
    if (base.length > "WARP/".length) {
      set.push(base);
      set.push(`${base}-forge`);
    }
  }
  return Array.from(new Set(set));
}

/**
 * Resolve the paired WARP•FORGE PR for a given WARP•SENTINEL PR. The
 * lookup tries (in order):
 *   1. Body line `Pairs: #N` → direct `pulls.get` by number.
 *   2. Body line `Pairs: WARP/<ref>` → `pulls.list` by head.
 *   3. Convention: `WARP/<slug>-sentinel` → try `WARP/<slug>` then
 *      `WARP/<slug>-forge`.
 * Returns the first match. When multiple PRs share a head ref, prefers
 * the merged one (so a re-opened branch doesn't downgrade the gate).
 *
 * IMPORTANT for operators — accepted SENTINEL pairing hints:
 *   • Branch convention: name your SENTINEL branch `WARP/<slug>-sentinel`
 *     so it auto-pairs with `WARP/<slug>` or `WARP/<slug>-forge`.
 *   • Explicit ref: add a `Pairs: WARP/<ref>` line in the SENTINEL PR
 *     body to point at a specific head ref.
 *   • `Pairs: #N` (numeric) is ONLY trusted when one of the two hints
 *     above is also present AND the resolved PR's head ref matches.
 *     A bare `Pairs: #N` with no convention/ref hint is ignored — this
 *     prevents an unrelated merged WARP/* PR from satisfying G1.
 */
export async function findPairedForgePR(sentinelPR: {
  branch: string;
  body: string;
}): Promise<PairedForgeLookup> {
  const octokit = getClient();
  const candidates = deriveCandidatePairs(
    sentinelPR.branch,
    sentinelPR.body ?? "",
  );

  // Direct PR-number lookup — most specific signal. We MUST validate
  // the resolved PR is actually the WARP•FORGE pair, otherwise a
  // stray `Pairs: #N` line could let an unrelated merged PR satisfy
  // the SENTINEL gate. Strict acceptance rule:
  //   • `candidates` MUST be non-empty (i.e. the SENTINEL PR either
  //     follows the `-sentinel` branch convention, or its body has an
  //     explicit `Pairs: WARP/<ref>` hint), AND
  //   • the resolved PR's head ref MUST be in that candidate set.
  // If candidates are empty we have no independent signal to verify
  // the pair identity, so we ignore `Pairs: #N` entirely and force
  // the user to either follow the branch convention or add a
  // `Pairs: WARP/<ref>` body line. This eliminates the bypass where
  // an unrelated merged WARP/* PR could be claimed as the pair.
  const numMatch = (sentinelPR.body ?? "").match(PAIRS_NUMBER_RE);
  if (numMatch && candidates.length > 0) {
    const n = Number.parseInt(numMatch[1], 10);
    if (Number.isInteger(n) && n > 0) {
      try {
        const res = await octokit.rest.pulls.get({
          owner: REPO_OWNER,
          repo: REPO_NAME,
          pull_number: n,
        });
        const resolvedRef = res.data.head?.ref ?? "";
        if (candidates.includes(resolvedRef)) {
          return {
            resolved: true,
            merged: !!res.data.merged,
            attemptedRefs: [`#${n}`, ...candidates],
          };
        }
        // Identity failed — do NOT trust this `Pairs: #N`. Fall
        // through to ref-based candidate resolution below.
      } catch {
        // Fall through to ref-based candidates.
      }
    }
  }

  for (const ref of candidates) {
    try {
      const res = await octokit.rest.pulls.list({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        state: "all",
        head: `${REPO_OWNER}:${ref}`,
        per_page: 5,
        sort: "updated",
        direction: "desc",
      });
      if (res.data.length > 0) {
        const mergedHit = res.data.find((p) => p.merged_at !== null);
        if (mergedHit) {
          return { resolved: true, merged: true, attemptedRefs: candidates };
        }
        return { resolved: true, merged: false, attemptedRefs: candidates };
      }
    } catch {
      // Try the next candidate ref. Network / 404 here just means no
      // pairing — the route surfaces "could not be resolved".
    }
  }

  return { resolved: false, merged: false, attemptedRefs: candidates };
}

/**
 * Close the given PR. Posts the supplied reason as a comment first
 * (so the close has a paper trail on the GitHub thread), then closes.
 * The comment failure does not block the close — we still try to
 * close and surface a partial-success error if comment failed.
 */
export async function closePR(
  prNumber: number,
  reason: string,
): Promise<{ closed: boolean; commentPosted: boolean }> {
  const octokit = getClient();
  let commentPosted = false;
  try {
    if (reason.trim().length > 0) {
      await octokit.rest.issues.createComment({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        issue_number: prNumber,
        body: `**WARP🔹CMD close** — ${reason.trim()}`,
      });
      commentPosted = true;
    }
  } catch {
    // Comment failed but we still try to close. Caller decides whether
    // to treat partial success as a failure.
    commentPosted = false;
  }

  try {
    await octokit.rest.pulls.update({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      pull_number: prNumber,
      state: "closed",
    });
    return { closed: true, commentPosted };
  } catch (err: unknown) {
    throw sanitize(err, "close");
  }
}

/**
 * Task #30 — Resolve the GitHub Actions check-run status for the given
 * head SHA, narrowed to the named workflow job (default `"test"` —
 * matches the `jobs.test` block in `.github/workflows/ci.yml`).
 *
 * Returns one of the `CiStatus` strings consumed by `evaluateMergeGates`:
 *
 *   "success"  → latest matching check_run.conclusion === "success"
 *   "failure"  → conclusion is one of failure / cancelled / timed_out
 *                / action_required / startup_failure / stale / neutral
 *   "pending"  → status is queued or in_progress (no conclusion yet)
 *   "missing"  → no check_run with that name exists for the SHA
 *
 * On Octokit / network failure we degrade to `"missing"` rather than
 * throwing — the gate then surfaces the "CI has not run on this
 * commit" blocker, which is the safe default (operators see the gate
 * blocked instead of silently merging).
 *
 * If multiple check_runs share the name (re-runs), GitHub returns
 * them newest-first; we take the first one.
 */
export async function getPRCheckStatus(
  headSha: string,
  checkName: string = "test",
): Promise<CiStatus> {
  if (!headSha) return "missing";
  const octokit = getClient();
  try {
    const res = await octokit.rest.checks.listForRef({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      ref: headSha,
      check_name: checkName,
      per_page: 10,
      filter: "latest",
    });
    const runs = res.data.check_runs ?? [];
    if (runs.length === 0) return "missing";
    const latest = runs[0];
    if (latest.status === "queued" || latest.status === "in_progress") {
      return "pending";
    }
    if (latest.conclusion === "success") return "success";
    return "failure";
  } catch {
    // Sanitized swallow — see contract above. We don't surface the
    // raw Octokit error to keep the gate decision deterministic and
    // PAT-safe.
    return "missing";
  }
}

/**
 * Convert any Octokit / network error into a sanitized Error whose
 * `.message` is safe to surface to the client. NEVER re-throws the raw
 * Octokit error (which can echo the PAT via response headers).
 *
 * Special-cases 403 on the `merge` op to a PAT-scope hint per Risk #1.
 */
function sanitize(
  err: unknown,
  op: "list" | "detail" | "merge" | "close" | "hold",
): Error {
  const e = err as {
    status?: number;
    name?: string;
    message?: string;
  } | null;
  const status = e?.status ?? 0;
  const name = e?.name ?? "Error";
  const raw = (e?.message ?? "unknown").slice(0, 300);

  if (op === "merge" && status === 403) {
    return new Error(
      "github_merge_403: PAT missing pull_requests:write — re-grant in repo settings",
    );
  }
  if (op === "merge" && status === 405) {
    return new Error(
      `github_merge_405: PR not mergeable (already merged, conflict, or branch protection)`,
    );
  }
  return new Error(`github_${op}_${status || "x"}: ${name}: ${raw}`);
}
