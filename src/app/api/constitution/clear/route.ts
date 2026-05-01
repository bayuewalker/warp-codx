import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { isAdminAllowed } from "@/lib/adminGate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/constitution/clear
 *
 * Wipes the constitution_cache table. Used by the Settings panel's
 * CLEAR CACHE action. Gated behind isAdminAllowed in production to
 * prevent unauthenticated cache wipes / DoS amplification.
 */
export async function POST(req: Request) {
  if (!isAdminAllowed(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const supabase = getServerSupabase();
  // PostgREST requires a filter even for delete-all.
  const { error, count } = await supabase
    .from("constitution_cache")
    .delete({ count: "exact" })
    .not("path", "is", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ cleared: count ?? 0 });
}
