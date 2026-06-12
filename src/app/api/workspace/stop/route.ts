/**
 * POST /api/workspace/stop → stop the box but keep its filesystem.
 *
 * The next create/file/exec call resumes it. Separate from DELETE (which is a
 * destructive reset) so the UI can offer a cheap "pause" without losing work.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roles";
import { unauthorized } from "@/lib/route-helpers";
import { stopWorkspace } from "@/lib/agent/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  await stopWorkspace(user.id);
  return NextResponse.json({ ok: true });
}
