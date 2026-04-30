import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId query param is required" },
        { status: 400 },
      );
    }
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("messages")
      .select("id, session_id, role, content, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ messages: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
