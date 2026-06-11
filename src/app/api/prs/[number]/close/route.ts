/**
 * Phase 3c — POST /api/prs/[number]/close
 *
 * Closes a PR on `bayuewalker/walkermind-os`. Posts the supplied
 * reason as an issue comment first (so the GitHub thread has a paper
 * trail), then closes the PR. Best-effort audit row inserted to
 * `pr_actions { action: "close", verdict: "ok", reason }`.
 *
 * Request body:
 *   { sessionId?: string | null, reason: string }
 *      reason: ≤ 1000 chars after trim. Empty string is rejected
 *      (use the GitHub UI directly if you genuinely want a no-comment
 *      close — we want every CodX-driven close to leave a trace).
 *
 * Response (200):
 *   { closed: true, prNumber: number, commentPosted: boolean }
 *
 * Response (400 / 409):
 *   { error: "<reason>" }
 *
 * AUTH GATE: `isAdminAllowed` (dev permissive, prod requires
 * `x-warp-admin-token`).
 */
import { NextResponse } from "next/server";
import { getPRDetail, closePR } from "@/lib/github-prs";
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

type CloseBody = {
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

  let parsed: CloseBody;
  try {
    parsed = (await req.json()) as CloseBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const sessionId = parseSessionId(parsed.sessionId);
  const reasonResult = validateReason(parsed.reason);
  if (!reasonResult.ok) return reasonResult.response;
  const { reason } = reasonResult;

  // Quick sanity check — refuse to close an already-closed/merged PR.
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
    result = await closePR(prNumber, reason);
  } catch (err) {
    const message = err instanceof Error ? err.message : "github close failed";
    // `github_close_<status>: ...` — pass-through 401/404/422.
    return NextResponse.json(
      { error: message },
      { status: statusFromAdapterError(message) },
    );
  }

  await auditPRAction("close", {
    session_id: sessionId,
    pr_number: prNumber,
    action: "close",
    verdict: "ok",
    reason,
  });

  // Phase 4 — fire-and-forget push notification, and Phase 3.5
  // (option a) — fire-and-forget TASK_COMPLETE marker. Both detached
  // so the response is never blocked. See issues/create/route.ts for
  // the marker contract.
  fireAndForget(
    "[push] close dispatch",
    sendPushToAll({
      title: "❌ PR closed",
      body: `${pr.branch} — ${reason.slice(0, 60)}`,
      tag: `pr-${prNumber}`,
      url: pr.url,
    }),
  );
  fireAndForget(
    "[task-complete-write] close dispatch",
    writeTaskCompleteMessage(sessionId, {
      kind: "pr_closed",
      pr: { number: prNumber, reason, url: pr.url },
    }),
  );

  return NextResponse.json({
    closed: result.closed,
    commentPosted: result.commentPosted,
    prNumber,
  });
}
