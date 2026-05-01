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
import { getServerSupabase } from "@/lib/supabase";
import { sendPushToAll } from "@/lib/push-server";
import { writeTaskCompleteMessage } from "@/lib/task-complete-write";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CloseBody = {
  sessionId?: string | null;
  reason?: string;
};

const MAX_REASON_LEN = 1000;

async function audit(row: {
  session_id: string | null;
  pr_number: number;
  reason: string;
}) {
  try {
    const supabase = getServerSupabase();
    const { error } = await supabase.from("pr_actions").insert({
      ...row,
      action: "close",
      verdict: "ok",
    });
    if (error) {
      console.error(
        `[prs/close] audit insert failed (pr #${row.pr_number}): ${error.message}`,
      );
    }
  } catch (err) {
    console.error(
      `[prs/close] audit insert threw (pr #${row.pr_number}): ${
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

  let parsed: CloseBody;
  try {
    parsed = (await req.json()) as CloseBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const reason = (parsed.reason ?? "").trim();
  const sessionId =
    typeof parsed.sessionId === "string" && parsed.sessionId.length > 0
      ? parsed.sessionId
      : null;

  if (reason.length === 0) {
    return NextResponse.json(
      { error: "reason is required" },
      { status: 400 },
    );
  }
  if (reason.length > MAX_REASON_LEN) {
    return NextResponse.json(
      { error: `reason must be ≤ ${MAX_REASON_LEN} chars` },
      { status: 400 },
    );
  }

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

  await audit({ session_id: sessionId, pr_number: prNumber, reason });

  // Phase 4 — fire-and-forget push notification. Detached (`void`)
  // so the response is never blocked on Supabase select + push fanout.
  // `sendPushToAll` swallows every error internally; the `.catch` here
  // is a defensive guard against any future regression.
  void sendPushToAll({
    title: "❌ PR closed",
    body: `${pr.branch} — ${reason.slice(0, 60)}`,
    tag: `pr-${prNumber}`,
    url: pr.url,
  }).catch((err) =>
    console.error(
      `[push] close dispatch escaped: ${
        err instanceof Error ? err.message : "unknown"
      }`,
    ),
  );

  // Phase 3.5 (option a) — fire-and-forget TASK_COMPLETE marker.
  // See issues/create/route.ts for the contract.
  void writeTaskCompleteMessage(sessionId, {
    kind: "pr_closed",
    pr: { number: prNumber, reason, url: pr.url },
  }).catch((err) =>
    console.error(
      `[task-complete-write] close dispatch escaped: ${
        err instanceof Error ? err.message : "unknown"
      }`,
    ),
  );

  return NextResponse.json({
    closed: result.closed,
    commentPosted: result.commentPosted,
    prNumber,
  });
}
