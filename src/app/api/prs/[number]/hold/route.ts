/**
 * Phase 3c gate hardening (G3) — POST /api/prs/[number]/hold
 *
 * Manual HOLD action. Mirrors the close route but does NOT change the
 * PR state on GitHub — HOLD is a soft pause per COMMANDER.md. Posts a
 * `**WARP🔹CMD hold** — <reason>` comment on the PR thread (so the
 * paper trail lives on GitHub) and inserts an audit row
 * `pr_actions { action: "hold", verdict: "manual", reason }` so the
 * automatic gate-blocked HOLDs (verdict: "blocked") stay distinguishable
 * from operator-tapped HOLDs.
 *
 * Request body:
 *   { sessionId?: string | null, reason: string }
 *      reason: ≤ 1000 chars after trim. Empty string is rejected — every
 *      manual HOLD must explain itself.
 *
 * Response (200):
 *   { held: true, prNumber, commentPosted: boolean }
 *
 * Response (400 / 409 / 500):
 *   { error: "<sanitized message>" }
 *
 * AUTH GATE: `isAdminAllowed` (dev permissive, prod requires
 * `x-warp-admin-token`).
 */
import { NextResponse } from "next/server";
import { getPRDetail, holdPR } from "@/lib/github-prs";
import { isAdminAllowed } from "@/lib/adminGate";
import { statusFromAdapterError } from "@/lib/route-error";
import { sendPushToAll } from "@/lib/push-server";
import { writeTaskCompleteMessage } from "@/lib/task-complete-write";
import {
  auditPRAction,
  fireAndForget,
  invalidPRNumberResponse,
  parsePRNumber,
  parseSessionId,
  validateReason,
} from "@/lib/pr-route-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HoldBody = {
  sessionId?: string | null;
  reason?: string;
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

  let parsed: HoldBody;
  try {
    parsed = (await req.json()) as HoldBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const sessionId = parseSessionId(parsed.sessionId);
  const reasonResult = validateReason(parsed.reason);
  if (!reasonResult.ok) return reasonResult.response;
  const { reason } = reasonResult;

  // Refuse to hold an already-closed/merged PR — the comment would
  // mislead. The card prevents this client-side too, but the server
  // is the source of truth.
  let pr;
  try {
    pr = await getPRDetail(prNumber);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "github detail failed";
    // Adapter errors arrive sanitized as `github_detail_<status>: ...`.
    // See `src/lib/route-error.ts` for the pass-through set.
    return NextResponse.json(
      { error: message },
      { status: statusFromAdapterError(message) },
    );
  }
  if (pr.state !== "open") {
    return NextResponse.json(
      { error: `PR is already ${pr.state}` },
      { status: 409 },
    );
  }

  let result;
  try {
    result = await holdPR(prNumber, reason);
  } catch (err) {
    const message = err instanceof Error ? err.message : "github hold failed";
    // `github_hold_<status>: ...` — pass-through 401/404/422.
    return NextResponse.json(
      { error: message },
      { status: statusFromAdapterError(message) },
    );
  }

  await auditPRAction("hold", {
    session_id: sessionId,
    pr_number: prNumber,
    action: "hold",
    verdict: "manual",
    reason,
  });

  // Phase 4 — fire-and-forget push notification, and Phase 3.5
  // (option a) — fire-and-forget TASK_COMPLETE marker. Both detached
  // so the response is never blocked. See issues/create/route.ts for
  // the marker contract.
  fireAndForget(
    "[push] hold dispatch",
    sendPushToAll({
      title: "⏸ PR held",
      body: `${pr.branch} — ${reason.slice(0, 60)}`,
      tag: `pr-${prNumber}`,
      url: pr.url,
    }),
  );
  fireAndForget(
    "[task-complete-write] hold dispatch",
    writeTaskCompleteMessage(sessionId, {
      kind: "pr_held",
      pr: { number: prNumber, reason, url: pr.url },
    }),
  );

  return NextResponse.json({
    held: true,
    prNumber,
    commentPosted: result.commentPosted,
  });
}
