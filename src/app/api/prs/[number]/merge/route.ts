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
import {
  getPRDetail,
  mergePR,
  findPairedForgePR,
  getPRCheckStatus,
} from "@/lib/github-prs";
import { evaluateMergeGates, isSentinelPR } from "@/lib/pr-gates";
import { isAdminAllowed } from "@/lib/adminGate";
import { statusFromAdapterError } from "@/lib/route-error";
import { getServerSupabase } from "@/lib/supabase";
import { sendPushToAll } from "@/lib/push-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MergeBody = {
  sessionId?: string | null;
};

function parseSlug(branch: string): string {
  return branch.startsWith("WARP/") ? branch.slice("WARP/".length) : branch;
}

async function audit(row: {
  session_id: string | null;
  pr_number: number;
  action: "merge" | "hold";
  verdict: "ok" | "blocked";
  reason: string | null;
}) {
  try {
    const supabase = getServerSupabase();
    const { error } = await supabase.from("pr_actions").insert(row);
    if (error) {
      console.error(
        `[prs/merge] audit insert failed (pr #${row.pr_number}, action=${row.action}): ${error.message}`,
      );
    }
  } catch (err) {
    console.error(
      `[prs/merge] audit insert threw (pr #${row.pr_number}): ${
        err instanceof Error ? err.message : "unknown"
      }`,
    );
  }
}

export async function POST(
  req: Request,
  ctx: { params: { number: string } },
) {
  if (!isAdminAllowed(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const prNumber = Number.parseInt(ctx.params.number, 10);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return NextResponse.json(
      { error: "pr number must be a positive integer" },
      { status: 400 },
    );
  }

  let body: MergeBody = {};
  try {
    // Body is optional — POST with empty body is allowed.
    const text = await req.text();
    if (text.trim().length > 0) body = JSON.parse(text) as MergeBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.length > 0
      ? body.sessionId
      : null;

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

  // 2a) Phase 3c gate hardening (G1) — if this PR is a SENTINEL PR,
  //     resolve its paired FORGE PR. The evaluator stays pure; this
  //     route does the I/O. Failures degrade to `null` so the
  //     evaluator surfaces the distinct "could not be resolved"
  //     blocker instead of false-positive merging.
  let forgePRMerged: boolean | null = null;
  if (isSentinelPR(pr.title, pr.body)) {
    try {
      const lookup = await findPairedForgePR({
        branch: pr.branch,
        body: pr.body,
      });
      forgePRMerged = lookup.resolved ? lookup.merged : null;
    } catch {
      forgePRMerged = null;
    }
  }

  // 2c) Task #30 — fetch the CI status fresh on the merge call, NOT
  //     trusting the card's snapshot. CI may have flipped from
  //     pending → success between the card render and the operator
  //     tapping MERGE.
  const ciStatus = await getPRCheckStatus(pr.headSha);

  // 2b) Gate evaluation — single source of truth. Same call the card made.
  const gates = evaluateMergeGates(
    {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      head: { ref: pr.branch },
    },
    pr.reviews.map((r) => ({ state: r.state, body: r.body })),
    { forgePRMerged, ciStatus },
  );
  if (!gates.ok) {
    await audit({
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
  await audit({
    session_id: sessionId,
    pr_number: prNumber,
    action: "merge",
    verdict: "ok",
    reason: null,
  });

  // 5) Phase 4 — fire-and-forget push notification. `sendPushToAll`
  //    swallows every error internally, but we still detach (`void`)
  //    so the response is never blocked on Supabase select + push
  //    fanout + GC. A defensive `.catch` guards against any future
  //    regression where an error escapes the helper's internal try.
  void sendPushToAll({
    title: "✅ PR merged",
    body: `${pr.branch} → ${pr.baseBranch}`,
    tag: `pr-${prNumber}`,
    url: pr.url,
  }).catch((err) =>
    console.error(
      `[push] merge dispatch escaped: ${
        err instanceof Error ? err.message : "unknown"
      }`,
    ),
  );

  return NextResponse.json({
    merged: true,
    sha: outcome.sha,
    prNumber,
    branch: pr.branch,
    postMergeReminder: `Post-merge sync required: update PROJECT_STATE.md + ROADMAP.md + WORKTODO.md + CHANGELOG.md for WARP/${slug}`,
  });
}
