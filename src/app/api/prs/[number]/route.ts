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
 * truth — the card displays exactly what the merge route will enforce
 * (both call `evaluateGatesForPR`).
 */
import { NextResponse } from "next/server";
import { getPRDetail } from "@/lib/github-prs";
import { isAdminAllowed } from "@/lib/adminGate";
import { statusFromAdapterError } from "@/lib/route-error";
import {
  evaluateGatesForPR,
  invalidPRNumberResponse,
  parsePRNumber,
  parseSlug,
  postMergeReminder,
} from "@/lib/pr-route-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: { number: string } },
) {
  if (!isAdminAllowed(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const prNumber = parsePRNumber(ctx.params.number);
  if (prNumber === null) return invalidPRNumberResponse();

  try {
    const pr = await getPRDetail(prNumber);
    // Gate evaluation — shared with the merge route so the card
    // mirrors exactly what the server will enforce. Resolves the
    // paired FORGE PR for SENTINEL PRs (G1; failures degrade to a
    // distinct blocker) and the CI status for the head SHA (Task #30;
    // internal failures surface as "missing" → blocker).
    const gates = await evaluateGatesForPR(pr);
    return NextResponse.json({
      pr,
      gates,
      postMergeReminder: postMergeReminder(parseSlug(pr.branch)),
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
