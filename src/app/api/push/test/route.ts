/**
 * Phase 4 — POST /api/push/test
 *
 * Sends a canned test notification to every saved subscription.
 * Admin-gated (`isAdminAllowed`) so a public deploy can't be turned
 * into a notification spam cannon.
 *
 * Response (200): { sent: true }
 * Response (403): { error: "forbidden" }
 */
import { NextResponse } from "next/server";
import { isAdminAllowed } from "@/lib/adminGate";
import { sendPushToAll } from "@/lib/push-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isAdminAllowed(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await sendPushToAll({
    title: "🧪 Test notification",
    body: "WARP CodX push notifications are working",
    tag: "test",
    url: "/",
  });

  return NextResponse.json({ sent: true });
}
