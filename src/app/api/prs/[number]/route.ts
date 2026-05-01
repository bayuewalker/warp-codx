/**
 * Phase 3c — GET /api/prs/[number]
 *
 * Returns the full PR detail + reviews + parsed gate result for a
 * single PR on `bayuewalker/walkermind-os`. Used by:
 *   - PRCard (chat-inline) for its expanded checklist view
 *   - PRListView (drawer) when a row is opened
 *
 * Response (200):
 *   {
 *     pr: PRDetail,
 *     gates: GateResult,
 *     postMergeReminder: string   // canonical sync-line per spec
 *   }
 *
 * Failure (404 / 500): { error: "<sanitized message>" }
 *
 * AUTH GATE — admin-gated, mirroring `/api/issues/list` behavior.
 * Dev / preview is permissive; production requires `x-warp-admin-token`.
 *
 * The gate result is computed server-side as the single source of
 * truth — the card displays exactly what the merge route will enforce.
 */
import { NextResponse } from "next/server";
import {
  getPRDetail,
  findPairedForgePR,
  getPRCheckStatus,
} from "@/lib/github-prs";
import { evaluateMergeGates, isSentinelPR } from "@/lib/pr-gates";
import { isAdminAllowed } from "@/lib/adminGate";
import { statusFromAdapterError } from "@/lib/route-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseSlug(branch: string): string {
  return branch.startsWith("WARP/") ? branch.slice("WARP/".length) : branch;
}

export async function GET(
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

  try {
    const pr = await getPRDetail(prNumber);
    // Phase 3c gate hardening (G1) — if this PR is itself a SENTINEL
    // PR, resolve its paired FORGE PR so the card mirrors what the
    // merge route will enforce. Failures degrade to `null` (treated as
    // unmerged with a distinct blocker by the evaluator).
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
    // Task #30 — resolve the CI status for the PR head SHA so the card
    // and the merge route both consult the latest `test` check_run.
    // Internal failures degrade to "missing" inside `getPRCheckStatus`
    // — which surfaces as a blocker rather than silently passing.
    const ciStatus = await getPRCheckStatus(pr.headSha);
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
    const slug = parseSlug(pr.branch);
    return NextResponse.json({
      pr,
      gates,
      postMergeReminder: `Post-merge sync required: update PROJECT_STATE.md + ROADMAP.md + WORKTODO.md + CHANGELOG.md for WARP/${slug}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "github detail failed";
    // Adapter errors arrive sanitized as `github_detail_<status>: ...`.
    // Pass-through 401/404/422 unchanged; everything else → 500.
    // See `src/lib/route-error.ts` and Task #35 route tests.
    return NextResponse.json(
      { error: message },
      { status: statusFromAdapterError(message) },
    );
  }
}
