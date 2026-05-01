/**
 * Phase 4 — POST /api/push/unsubscribe
 *
 * Removes a saved PushSubscription by `endpoint`. Like subscribe,
 * intentionally NOT admin-gated — anyone with the device should be
 * able to opt themselves out.
 *
 * Request body: { endpoint: string }
 * Response (200): { unsubscribed: true, removed: number }
 * Response (400): { error }
 * Response (500): { error }
 */
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UnsubscribeBody = {
  endpoint?: string;
};

export async function POST(req: Request) {
  let parsed: UnsubscribeBody;
  try {
    parsed = (await req.json()) as UnsubscribeBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const endpoint = parsed.endpoint;
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    return NextResponse.json(
      { error: "endpoint is required" },
      { status: 400 },
    );
  }

  try {
    const supabase = getServerSupabase();
    const { error, count } = await supabase
      .from("push_subscriptions")
      .delete({ count: "exact" })
      .eq("endpoint", endpoint);
    if (error) {
      console.error(
        `[push/unsubscribe] supabase delete failed: ${error.message}`,
      );
      return NextResponse.json(
        { error: "failed to remove subscription" },
        { status: 500 },
      );
    }
    return NextResponse.json({ unsubscribed: true, removed: count ?? 0 });
  } catch (err) {
    console.error(
      `[push/unsubscribe] threw: ${err instanceof Error ? err.message : "unknown"}`,
    );
    return NextResponse.json(
      { error: "failed to remove subscription" },
      { status: 500 },
    );
  }
}
