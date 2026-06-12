/**
 * Persistent IDE workspace lifecycle.
 *
 *   GET    /api/workspace          → the caller's workspace status (no box attach)
 *   POST   /api/workspace { repoUrl?, branch? } → create/resume the box
 *   DELETE /api/workspace          → destroy the box + forget the mapping
 *
 * Creating a box spins up a sandbox and burns cost, so POST is gated by the same
 * access policy as the coding agent. Reading status and tearing down only
 * require the authenticated owner.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roles";
import { unauthorized } from "@/lib/route-helpers";
import { canLaunchCodingAgent } from "@/lib/agent/access";
import { getWorkspaceRecord } from "@/lib/agent/workspace-store";
import { destroyWorkspace, ensureWorkspace } from "@/lib/agent/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const record = await getWorkspaceRecord(user.id);
  return NextResponse.json({ workspace: record });
}

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();

  const access = canLaunchCodingAgent(user);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason }, { status: 403 });
  }

  let body: { repoUrl?: unknown; branch?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const repoUrl =
    typeof body.repoUrl === "string" && body.repoUrl.trim()
      ? body.repoUrl.trim()
      : undefined;
  const branch =
    typeof body.branch === "string" && body.branch.trim()
      ? body.branch.trim()
      : undefined;

  try {
    const { record } = await ensureWorkspace({ userId: user.id, repoUrl, branch });
    return NextResponse.json({ workspace: record }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  await destroyWorkspace(user.id);
  return NextResponse.json({ ok: true });
}
