/**
 * Phase 4 — GET /api/push/vapid-public-key
 *
 * Exposes the VAPID PUBLIC key (intentionally public — it's the half
 * a browser needs in order to call `pushManager.subscribe`). The
 * PRIVATE key never leaves the server.
 *
 * Returns: { publicKey: string } or { error } when not configured.
 */
import { NextResponse } from "next/server";
import { getVapidPublicKey } from "@/lib/push-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const key = getVapidPublicKey();
  if (!key) {
    return NextResponse.json(
      { error: "VAPID_PUBLIC_KEY not configured" },
      { status: 500 },
    );
  }
  return NextResponse.json({ publicKey: key });
}
