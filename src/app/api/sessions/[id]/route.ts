import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Task #37 — fetch a single session by id.
 *
 * After a chat stream finishes, the client needs the freshest
 * `updated_at` for the active session so the sidebar row hops to the
 * top of the list. Previously this was done by re-fetching the entire
 * `/api/sessions` payload — wasteful once history grows. With paginated
 * sessions this is also wrong (the active session may not be in the
 * first page), so we expose a per-id GET instead.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const id = params.id;
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("sessions")
      .select("id, label, created_at, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ session: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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
