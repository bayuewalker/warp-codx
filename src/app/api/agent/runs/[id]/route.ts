import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roles";
import { getAgentRun } from "@/lib/agent/agent-runs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/agent/runs/:id → { run }
 *
 * Full run record including the step transcript — the monitor UI polls this
 * while a run is `running`. Owner-scoped: a run belonging to another user is
 * reported as 404 (don't leak existence).
 */
export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const run = await getAgentRun(id);
  if (!run || run.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ run });
}
