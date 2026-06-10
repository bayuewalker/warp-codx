import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/me → { id, email, role } for the signed-in user, or 401.
 * The client uses `role` to decide whether to show the Admin panel.
 */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  return NextResponse.json(user);
}
