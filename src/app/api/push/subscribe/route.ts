/**
 * Phase 4 — POST /api/push/subscribe
 *
 * Persists a browser PushSubscription so the server can fan out
 * notifications to it later. Intentionally NOT admin-gated: anyone
 * with the URL who has physical access to the device should be able
 * to opt themselves in. The admin token only protects /api/push/test
 * (the abuse-amplification surface).
 *
 * Request body:
 *   {
 *     subscription: {
 *       endpoint: string,
 *       keys: { p256dh: string, auth: string }
 *     }
 *   }
 *
 * Response (200): { subscribed: true }
 * Response (400): { error: "invalid body" }
 * Response (500): { error: "<sanitized message>" }
 *
 * Idempotent on `endpoint` — re-subscribing from the same browser
 * upserts and updates `last_used_at` instead of creating duplicates.
 */
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SubscribeBody = {
  subscription?: {
    endpoint?: string;
    keys?: {
      p256dh?: string;
      auth?: string;
    };
  };
};

export async function POST(req: Request) {
  let parsed: SubscribeBody;
  try {
    parsed = (await req.json()) as SubscribeBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const sub = parsed.subscription;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;

  if (
    typeof endpoint !== "string" ||
    endpoint.length === 0 ||
    typeof p256dh !== "string" ||
    p256dh.length === 0 ||
    typeof auth !== "string" ||
    auth.length === 0
  ) {
    return NextResponse.json(
      {
        error:
          "subscription must include endpoint, keys.p256dh, and keys.auth",
      },
      { status: 400 },
    );
  }

  const userAgent = req.headers.get("user-agent") ?? "";

  try {
    const supabase = getServerSupabase();
    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          endpoint,
          p256dh,
          auth,
          user_agent: userAgent,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );
    if (error) {
      console.error(`[push/subscribe] supabase upsert failed: ${error.message}`);
      return NextResponse.json(
        { error: "failed to persist subscription" },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error(
      `[push/subscribe] threw: ${err instanceof Error ? err.message : "unknown"}`,
    );
    return NextResponse.json(
      { error: "failed to persist subscription" },
      { status: 500 },
    );
  }

  return NextResponse.json({ subscribed: true });
}
