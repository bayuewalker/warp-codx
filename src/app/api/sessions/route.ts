import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("sessions")
      .select("id, label, created_at, updated_at")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ sessions: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      label?: string;
    };
    const label =
      typeof body.label === "string" && body.label.trim().length > 0
        ? body.label.trim().slice(0, 120)
        : `New directive · ${new Date().toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })}`;

    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("sessions")
      .insert({ label })
      .select("id, label, created_at, updated_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ session: data }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
