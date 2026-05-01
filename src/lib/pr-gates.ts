/**
 * Phase 3c — Pre-merge gate evaluation for WARP/* pull requests.
 *
 * SINGLE SOURCE OF TRUTH for both the merge route's hard server-side
 * block AND the PRCard's checklist display. Card and server MUST
 * read from this same function so the UI never lies about what the
 * server will do.
 *
 * Mirrors the rules in COMMANDER.md / AGENTS.md:
 *   1. PR body declares all four: Validation Tier, Claim Level,
 *      Validation Target, Not in Scope.
 *   2. Branch ref starts with "WARP/" and contains no whitespace
 *      or ".." sequences.
 *   3. PR body declares both WARP•FORGE output markers `Report:` and
 *      `State:` (Phase 3c gate hardening — G2).
 *   4. If Validation Tier === MAJOR, at least one APPROVED review
 *      whose body identifies as WARP•SENTINEL and contains the
 *      word APPROVED or CONDITIONAL.
 *   5. If the PR itself is a WARP•SENTINEL PR (signature in title or
 *      body), its paired WARP•FORGE PR must already be merged
 *      (Phase 3c gate hardening — G1). The pairing lookup is performed
 *      by the merge / detail route — this evaluator stays pure and
 *      receives the resolved boolean via `opts.forgePRMerged`.
 *   6. Task #30 — if the route resolved a CI status for the PR's
 *      head SHA (the `test` job from `.github/workflows/ci.yml`),
 *      that status must be `"success"`. `"failure"` / `"pending"` /
 *      `"missing"` all block. When the route doesn't pass `ciStatus`
 *      (undefined / null) the gate is N/A — preserves backward
 *      compatibility with callers that pre-date CI.
 *
 * The SENTINEL signature regex tolerates encoding drift — `•` (U+2022),
 * `·` (U+00B7), `-`, `.`, or whitespace between WARP and SENTINEL — to
 * survive the same diamond/bullet character mangling we hit in the
 * Phase 3a constitution code.
 *
 * Pure module: no I/O, no side effects, no logging. Suitable for unit
 * testing and for the hot path of the merge route (called twice per
 * merge — once for the card preview, once on the server right before
 * the actual merge).
 */

export type Tier = "MINOR" | "STANDARD" | "MAJOR" | null;

/**
 * Slim PR shape we depend on. Compatible with the GitHub REST API
 * `pulls.get` response; we only read these fields so callers can pass
 * either the raw Octokit object or a normalised one. `title` is
 * optional — when present it joins `body` for the WARP•SENTINEL
 * signature scan.
 */
export type GhPR = {
  number: number;
  title?: string | null;
  body: string | null;
  head: { ref: string };
};

/**
 * Slim review shape. Compatible with `pulls.listReviews` items.
 * `state` per GitHub: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" |
 * "DISMISSED" | "PENDING".
 */
export type GhReview = {
  state: string;
  body: string | null;
};

/**
 * Resolved CI status for the PR head SHA. The route looks up the
 * `test` check run from `.github/workflows/ci.yml` and translates its
 * conclusion + status here:
 *
 *   "success"  → the test job finished and passed → gate passes
 *   "failure"  → the test job finished and failed (failure | cancelled
 *                | timed_out | action_required | startup_failure)
 *   "pending"  → the test job is queued or in_progress → gate blocks
 *                so we don't merge before tests finish
 *   "missing"  → no `test` check run exists for this head SHA at all
 *                (CI may not have triggered yet, or the workflow file
 *                was removed)
 *
 * Pass `null` / undefined to skip the CI gate entirely (gate becomes
 * N/A — preserves backward-compatibility with the existing tests that
 * pre-date Task #30).
 */
export type CiStatus = "success" | "failure" | "pending" | "missing";

/**
 * Optional inputs supplied by the route.
 *
 * `forgePRMerged` (Phase 3c G1):
 *   true  → paired FORGE PR resolved AND merged
 *   false → paired FORGE PR resolved but NOT yet merged
 *   null  → resolution failed (no candidate ref found) → treated as
 *           unmerged with a distinct blocker string
 *   Ignored entirely when the PR is not detected as SENTINEL.
 *
 * `ciStatus` (Task #30):
 *   See `CiStatus` above. `null` / undefined → gate is N/A.
 */
export type GateOptions = {
  forgePRMerged?: boolean | null;
  ciStatus?: CiStatus | null;
};

export type GateResult = {
  ok: boolean;
  tier: Tier;
  /** True when SENTINEL signature found in PR title or body. */
  isSentinel: boolean;
  gates: {
    tierDeclared: boolean;
    claimDeclared: boolean;
    targetDeclared: boolean;
    notInScopeDeclared: boolean;
    branchFormat: boolean;
    /** True when tier !== MAJOR (gate not applicable). */
    sentinelApproved: boolean;
    /** True iff PR body has both `Report:` and `State:` lines. */
    forgeOutputComplete: boolean;
    /** True when not SENTINEL (N/A) or paired FORGE PR is merged. */
    forgeMerged: boolean;
    /**
     * True when no CI signal was supplied (gate N/A) OR the resolved
     * `test` check run conclusion is `"success"`. False when CI is
     * pending, failed, or missing for the head SHA.
     */
    ciPassed: boolean;
  };
  /**
   * Echo of the CI status the route resolved (or null when no signal
   * was supplied). Surfaced so the PRCard can render the live state
   * even though this evaluator stays pure.
   */
  ciStatus: CiStatus | null;
  /** Human-readable blocker strings; empty when ok === true. */
  blockers: string[];
};

/** Tier line: "Validation Tier: MAJOR" (case-insensitive, anywhere on a line). */
const TIER_RE = /^\s*Validation Tier:\s*(MINOR|STANDARD|MAJOR)\b/im;

/** Each declaration is a line that begins with the labeled key, followed by content. */
const CLAIM_RE = /^\s*Claim Level:\s*\S/im;
const TARGET_RE = /^\s*Validation Target:\s*\S/im;
const NOT_IN_SCOPE_RE = /^\s*Not in Scope:\s*\S/im;

/** WARP•FORGE output markers per COMMANDER.md (G2 — Phase 3c hardening). */
const REPORT_RE = /^\s*Report:\s*\S/im;
const STATE_RE = /^\s*State:\s*\S/im;

/**
 * SENTINEL signature — tolerates `WARP•SENTINEL`, `WARP·SENTINEL`,
 * `WARP-SENTINEL`, `WARP.SENTINEL`, `WARP SENTINEL`. Bullet U+2022,
 * middot U+00B7, hyphen, dot, or whitespace between the two tokens.
 */
const SENTINEL_SIG_RE = /WARP[\u2022\u00b7\.\-\s]*SENTINEL/i;

/** APPROVED or CONDITIONAL anywhere in the review body, word-bounded. */
const SENTINEL_VERDICT_RE = /\b(APPROVED|CONDITIONAL)\b/i;

function parseTier(body: string | null): Tier {
  if (!body) return null;
  const m = body.match(TIER_RE);
  if (!m) return null;
  const v = m[1].toUpperCase();
  if (v === "MINOR" || v === "STANDARD" || v === "MAJOR") return v;
  return null;
}

function isBranchFormatOk(ref: string): boolean {
  if (!ref.startsWith("WARP/")) return false;
  if (/\s/.test(ref)) return false;
  if (ref.includes("..")) return false;
  // Must have something after the prefix.
  if (ref.length <= "WARP/".length) return false;
  return true;
}

function hasSentinelApproval(reviews: GhReview[]): boolean {
  for (const r of reviews) {
    if (r.state !== "APPROVED") continue;
    const body = r.body ?? "";
    if (SENTINEL_SIG_RE.test(body) && SENTINEL_VERDICT_RE.test(body)) {
      return true;
    }
  }
  return false;
}

/**
 * Detect whether the PR itself is a WARP•SENTINEL PR. The route uses
 * this to decide whether to perform the paired-FORGE lookup before
 * calling `evaluateMergeGates`. Looks at title + body together — the
 * signature can appear in either.
 */
export function isSentinelPR(
  title: string | null | undefined,
  body: string | null | undefined,
): boolean {
  const haystack = `${title ?? ""}\n${body ?? ""}`;
  return SENTINEL_SIG_RE.test(haystack);
}

export function evaluateMergeGates(
  pr: GhPR,
  reviews: GhReview[],
  opts: GateOptions = {},
): GateResult {
  const body = pr.body ?? "";
  const title = pr.title ?? "";
  const tier = parseTier(body);
  const isSentinel = isSentinelPR(title, body);

  const tierDeclared = tier !== null;
  const claimDeclared = CLAIM_RE.test(body);
  const targetDeclared = TARGET_RE.test(body);
  const notInScopeDeclared = NOT_IN_SCOPE_RE.test(body);
  const branchFormat = isBranchFormatOk(pr.head.ref);
  // For non-MAJOR PRs the gate is N/A — return true so it doesn't
  // appear as a blocker. Only MAJOR PRs require live SENTINEL review.
  const sentinelApproved =
    tier === "MAJOR" ? hasSentinelApproval(reviews) : true;

  // G2 — WARP•FORGE output markers (every WARP/* PR is expected to
  // carry forge output per COMMANDER.md).
  const reportLine = REPORT_RE.test(body);
  const stateLine = STATE_RE.test(body);
  const forgeOutputComplete = reportLine && stateLine;

  // G1 — SENTINEL→FORGE pairing. N/A when this PR isn't a SENTINEL PR.
  const forgePRMerged = opts.forgePRMerged ?? null;
  const forgeMerged = isSentinel ? forgePRMerged === true : true;

  // Task #30 — CI gate. `null`/undefined → N/A (gate passes), preserving
  // backward compatibility with callers that don't query GitHub Checks.
  const ciStatus: CiStatus | null = opts.ciStatus ?? null;
  const ciPassed = ciStatus === null ? true : ciStatus === "success";

  const blockers: string[] = [];
  if (!tierDeclared) blockers.push("Validation Tier missing from PR body");
  if (!claimDeclared) blockers.push("Claim Level missing from PR body");
  if (!targetDeclared)
    blockers.push("Validation Target missing from PR body");
  if (!notInScopeDeclared)
    blockers.push("Not in Scope missing from PR body");
  if (!branchFormat)
    blockers.push(
      `Branch must start with "WARP/" (got "${pr.head.ref}")`,
    );
  if (!reportLine) blockers.push("WARP•FORGE output missing Report: line");
  if (!stateLine) blockers.push("WARP•FORGE output missing State: line");
  if (tier === "MAJOR" && !sentinelApproved)
    blockers.push("MAJOR tier — SENTINEL approval required");
  if (isSentinel && !forgeMerged) {
    if (forgePRMerged === null) {
      blockers.push(
        "WARP•SENTINEL — paired WARP•FORGE PR could not be resolved",
      );
    } else {
      blockers.push("WARP•SENTINEL — paired WARP•FORGE PR not yet merged");
    }
  }
  if (!ciPassed) {
    if (ciStatus === "failure") {
      blockers.push("CI failed — npm test broken on head SHA");
    } else if (ciStatus === "pending") {
      blockers.push("CI still running — wait for the test job to finish");
    } else if (ciStatus === "missing") {
      blockers.push(
        "CI has not run on this commit — push triggers .github/workflows/ci.yml",
      );
    }
  }

  return {
    ok: blockers.length === 0,
    tier,
    isSentinel,
    gates: {
      tierDeclared,
      claimDeclared,
      targetDeclared,
      notInScopeDeclared,
      branchFormat,
      sentinelApproved,
      forgeOutputComplete,
      forgeMerged,
      ciPassed,
    },
    ciStatus,
    blockers,
  };
}
