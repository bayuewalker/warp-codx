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
import { getServerSupabase } from "@/lib/supabase";
import { sendPushToAll } from "@/lib/push-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HoldBody = {
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
      action: "hold",
      verdict: "manual",
    });
    if (error) {
      console.error(
        `[prs/hold] audit insert failed (pr #${row.pr_number}): ${error.message}`,
      );
    }
  } catch (err) {
    console.error(
      `[prs/hold] audit insert threw (pr #${row.pr_number}): ${
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

  let parsed: HoldBody;
  try {
    parsed = (await req.json()) as HoldBody;
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

  await audit({ session_id: sessionId, pr_number: prNumber, reason });

  // Phase 4 — fire-and-forget push notification. Detached (`void`)
  // so the response is never blocked on Supabase select + push fanout.
  // `sendPushToAll` swallows every error internally; the `.catch` here
  // is a defensive guard against any future regression.
  void sendPushToAll({
    title: "⏸ PR held",
    body: `${pr.branch} — ${reason.slice(0, 60)}`,
    tag: `pr-${prNumber}`,
    url: pr.url,
  }).catch((err) =>
    console.error(
      `[push] hold dispatch escaped: ${
        err instanceof Error ? err.message : "unknown"
      }`,
    ),
  );

  return NextResponse.json({
    held: true,
    prNumber,
    commentPosted: result.commentPosted,
  });
}
