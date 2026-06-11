/**
 * Shared server-side helpers for the `/api/prs/*` route family.
 *
 * The merge / close / hold / detail routes follow the same contract:
 * admin gate → param + body validation → fresh GitHub re-fetch →
 * action → best-effort `pr_actions` audit row → fire-and-forget
 * notifications. This module centralizes the pieces that were
 * previously copy-pasted per route so the contract has one source of
 * truth. Behaviour (response shapes, audit rows, log prefixes) is
 * unchanged.
 */
import { NextResponse } from "next/server";
import { getServerSupabase } from "./supabase";
import { findPairedForgePR, getPRCheckStatus } from "./github-prs";
import {
  evaluateMergeGates,
  isSentinelPR,
  type GateResult,
  type GhReview,
} from "./pr-gates";

/** Subset of `PRDetail` the gate evaluation needs. */
export type GateablePR = {
  number: number;
  title: string;
  body: string;
  branch: string;
  headSha: string;
  reviews: GhReview[];
};

export type PRActionAudit = {
  session_id: string | null;
  pr_number: number;
  action: "merge" | "close" | "hold";
  verdict: "ok" | "blocked" | "manual";
  reason: string | null;
};

/** Max accepted length for an operator-supplied close / hold reason. */
export const MAX_REASON_LEN = 1000;

/**
 * Parse the `[number]` route param. Returns null for anything that is
 * not a positive integer (the caller responds 400).
 */
export function parsePRNumber(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Canonical 400 for an invalid `[number]` param. */
export function invalidPRNumberResponse(): NextResponse {
  return NextResponse.json(
    { error: "pr number must be a positive integer" },
    { status: 400 },
  );
}

/** `WARP/<slug>` branch → `<slug>`; other branches pass through. */
export function parseSlug(branch: string): string {
  return branch.startsWith("WARP/") ? branch.slice("WARP/".length) : branch;
}

/** Canonical post-merge sync reminder line (per spec). */
export function postMergeReminder(slug: string): string {
  return `Post-merge sync required: update PROJECT_STATE.md + ROADMAP.md + WORKTODO.md + CHANGELOG.md for WARP/${slug}`;
}

/** Normalize an optional body `sessionId` — non-empty string or null. */
export function parseSessionId(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Validate an operator-supplied reason (close / hold). Empty is
 * rejected — every CodX-driven close/hold must explain itself.
 */
export function validateReason(
  raw: unknown,
): { ok: true; reason: string } | { ok: false; response: NextResponse } {
  const reason = (typeof raw === "string" ? raw : "").trim();
  if (reason.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "reason is required" },
        { status: 400 },
      ),
    };
  }
  if (reason.length > MAX_REASON_LEN) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `reason must be ≤ ${MAX_REASON_LEN} chars` },
        { status: 400 },
      ),
    };
  }
  return { ok: true, reason };
}

/**
 * Best-effort `pr_actions` audit row. Never throws and never changes
 * the HTTP response — an audit failure must not undo a GitHub action.
 */
export async function auditPRAction(
  scope: "merge" | "close" | "hold",
  row: PRActionAudit,
): Promise<void> {
  try {
    const supabase = getServerSupabase();
    const { error } = await supabase.from("pr_actions").insert(row);
    if (error) {
      console.error(
        `[prs/${scope}] audit insert failed (pr #${row.pr_number}, action=${row.action}): ${error.message}`,
      );
    }
  } catch (err) {
    console.error(
      `[prs/${scope}] audit insert threw (pr #${row.pr_number}): ${
        err instanceof Error ? err.message : "unknown"
      }`,
    );
  }
}

/**
 * Detach a best-effort promise (push fanout, task-complete write) so
 * the response is never blocked on it. The helper itself swallows its
 * errors; the `.catch` here is a defensive guard against any future
 * regression where an error escapes.
 */
export function fireAndForget(label: string, promise: Promise<unknown>): void {
  void promise.catch((err) =>
    console.error(
      `${label} escaped: ${err instanceof Error ? err.message : "unknown"}`,
    ),
  );
}

/**
 * Gate evaluation — the single source of truth shared by the PR detail
 * route (what the card displays) and the merge route (what the server
 * enforces). Re-fetches both gate inputs fresh:
 *
 *   - SENTINEL PRs resolve their paired FORGE PR (G1 hardening).
 *     Lookup failures degrade to `null` so the evaluator surfaces the
 *     distinct "could not be resolved" blocker instead of
 *     false-positive merging.
 *   - CI status is read for the current head SHA (Task #30), never
 *     trusted from the client's snapshot.
 *
 * The two lookups are independent, so they run in parallel.
 */
export async function evaluateGatesForPR(pr: GateablePR): Promise<GateResult> {
  const [forgePRMerged, ciStatus] = await Promise.all([
    isSentinelPR(pr.title, pr.body)
      ? findPairedForgePR({ branch: pr.branch, body: pr.body })
          .then((lookup) => (lookup.resolved ? lookup.merged : null))
          .catch(() => null)
      : Promise.resolve<boolean | null>(null),
    getPRCheckStatus(pr.headSha),
  ]);

  return evaluateMergeGates(
    {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      head: { ref: pr.branch },
    },
    pr.reviews.map((r) => ({ state: r.state, body: r.body })),
    { forgePRMerged, ciStatus },
  );
}
