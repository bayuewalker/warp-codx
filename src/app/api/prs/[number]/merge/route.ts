/**
 * Phase 3c — POST /api/prs/[number]/merge
 *
 * Re-fetches PR + reviews fresh from GitHub, re-runs
 * `evaluateMergeGates` server-side (the SAME pure function the card
 * displays), and:
 *   - on `gates.ok === true` → squash-merge with the canonical
 *     commit title `Merged WARP/${slug} via WARP CodX`, then audit
 *     `pr_actions { action: "merge", verdict: "ok" }`.
 *   - on `gates.ok === false` → return HTTP 409 with the blockers,
 *     then audit `pr_actions { action: "hold", verdict: "blocked",
 *     reason: blockers.join(", ") }`.
 *
 * The gate is the SOLE pre-merge protection. The marker protocol can
 * pre-select the merge action in the UI, but the server is the only
 * place merges are actually executed.
 *
 * Request body:
 *   { sessionId?: string | null }
 *
 * Response (200):
 *   { merged: true, sha: string, prNumber: number, branch: string,
 *     postMergeReminder: string }
 *
 * Response (409 — gate blocked):
 *   { status: "HOLD", blockers: string[], gates: GateResult["gates"] }
 *
 * Failure (500):
 *   { error: "<sanitized github_merge_<status> message>" }
 *
 * AUTH GATE: `isAdminAllowed` (dev permissive, prod requires
 * `x-warp-admin-token`). Audit row insert is best-effort — never
 * undoes the GitHub merge. PAT is never logged or returned.
 */
import { NextResponse } from "next/server";
import { getPRDetail, mergePR } from "@/lib/github-prs";
import { isAdminAllowed } from "@/lib/adminGate";
import { statusFromAdapterError } from "@/lib/route-error";
import { sendPushToAll } from "@/lib/push-server";
import { writeTaskCompleteMessage } from "@/lib/task-complete-write";
import {
  auditPRAction,
  evaluateGatesForPR,
  fireAndForget,
  invalidPRNumberResponse,
  parsePRNumber,
  parseSessionId,
  parseSlug,
  postMergeReminder,
} from "@/lib/pr-route-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MergeBody = {
  sessionId?: string | null;
};

export async function POST(
  req: Request,
  ctx: { params: { number: string } },
) {
  if (!isAdminAllowed(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const prNumber = parsePRNumber(ctx.params.number);
  if (prNumber === null) return invalidPRNumberResponse();

  let body: MergeBody = {};
  try {
    // Body is optional — POST with empty body is allowed.
    const text = await req.text();
    if (text.trim().length > 0) body = JSON.parse(text) as MergeBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const sessionId = parseSessionId(body.sessionId);

  // 1) Fresh re-fetch from GitHub. The card may be stale; we trust
  //    nothing the client says about gate state.
  let pr;
  try {
    pr = await getPRDetail(prNumber);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "github detail failed";
    // Adapter errors arrive sanitized as `github_detail_<status>: ...`.
    // Map known 4xx codes back to the matching HTTP status; everything
    // else → 500. See `src/lib/route-error.ts` and Task #35 tests.
    return NextResponse.json(
      { error: message },
      { status: statusFromAdapterError(message) },
    );
  }

  if (pr.state === "merged") {
    return NextResponse.json(
      { error: "already merged", prNumber, sha: null },
      { status: 409 },
    );
  }
  if (pr.state === "closed") {
    return NextResponse.json(
      { error: "PR is closed — cannot merge", prNumber },
      { status: 409 },
    );
  }

  // 2) Gate evaluation — single source of truth, shared with the
  //    detail route the card renders from. Resolves the paired FORGE
  //    PR for SENTINEL PRs (G1) and the fresh CI status for the head
  //    SHA (Task #30) — never the card's snapshot.
  const gates = await evaluateGatesForPR(pr);
  if (!gates.ok) {
    await auditPRAction("merge", {
      session_id: sessionId,
      pr_number: prNumber,
      action: "hold",
      verdict: "blocked",
      reason: gates.blockers.join(", "),
    });
    return NextResponse.json(
      {
        status: "HOLD",
        blockers: gates.blockers,
        gates: gates.gates,
        tier: gates.tier,
      },
      { status: 409 },
    );
  }

  // 3) Execute squash merge.
  const slug = parseSlug(pr.branch);
  let outcome;
  try {
    outcome = await mergePR(prNumber, slug);
  } catch (err) {
    const message = err instanceof Error ? err.message : "github merge failed";
    // `github_merge_403` (PAT scope) and `github_merge_405` (PR not
    // mergeable) are the operator-meaningful 4xx cases here; 422/404
    // also pass through. See `src/lib/route-error.ts`.
    return NextResponse.json(
      { error: message },
      { status: statusFromAdapterError(message) },
    );
  }

  if (!outcome.merged) {
    return NextResponse.json(
      { error: outcome.message || "merge did not complete" },
      { status: 500 },
    );
  }

  // 4) Best-effort audit row.
  await auditPRAction("merge", {
    session_id: sessionId,
    pr_number: prNumber,
    action: "merge",
    verdict: "ok",
    reason: null,
  });

  // 5) Phase 4 — fire-and-forget push notification, and Phase 3.5
  //    (option a) — fire-and-forget TASK_COMPLETE marker into the
  //    originating chat session. Both are detached so the response is
  //    never blocked on Supabase select + push fanout. See
  //    issues/create/route.ts for the marker contract.
  fireAndForget(
    "[push] merge dispatch",
    sendPushToAll({
      title: "✅ PR merged",
      body: `${pr.branch} → ${pr.baseBranch}`,
      tag: `pr-${prNumber}`,
      url: pr.url,
    }),
  );
  fireAndForget(
    "[task-complete-write] merge dispatch",
    writeTaskCompleteMessage(sessionId, {
      kind: "pr_merged",
      pr: {
        number: prNumber,
        branch: pr.branch,
        mergeCommit: outcome.sha,
        url: pr.url,
      },
    }),
  );

  return NextResponse.json({
    merged: true,
    sha: outcome.sha,
    prNumber,
    branch: pr.branch,
    postMergeReminder: postMergeReminder(slug),
  });
}
