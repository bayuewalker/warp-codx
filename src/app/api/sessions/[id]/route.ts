import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const id = params.id;
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const supabase = getServerSupabase();
    const { error } = await supabase.from("sessions").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const id = params.id;
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as { label?: string };
    if (!body.label || typeof body.label !== "string") {
      return NextResponse.json(
        { error: "label is required" },
        { status: 400 },
      );
    }
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("sessions")
      .update({ label: body.label.slice(0, 120), updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, label, created_at, updated_at")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ session: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
