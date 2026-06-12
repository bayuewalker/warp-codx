import { NextResponse } from "next/server";
import { requireAdmin, requireUser } from "@/lib/roles";
import { listAgentRuns, type AgentRun } from "@/lib/agent/agent-runs";
import { startAgentRun } from "@/lib/agent/run-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** List view: drop the (potentially large) step transcript, keep a count. */
function toListItem(run: AgentRun) {
  const { steps, ...rest } = run;
  return { ...rest, stepCount: steps?.length ?? 0 };
}

/** GET /api/agent/runs → { runs } — the caller's own runs, newest first. */
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const runs = (await listAgentRuns(user.id)).map(toListItem);
  return NextResponse.json({ runs });
}

/**
 * POST /api/agent/runs { task, repoUrl?, branch?, maxSteps? } → { id }
 *
 * Starting an autonomous run spins up a sandbox and burns model credits, so
 * it's admin-gated. The run executes in the background; poll
 * GET /api/agent/runs/:id for progress.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    const status = auth.error === "unauthenticated" ? 401 : 403;
    return NextResponse.json({ error: auth.error }, { status });
  }

  let body: {
    task?: unknown;
    repoUrl?: unknown;
    branch?: unknown;
    maxSteps?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const task = typeof body.task === "string" ? body.task.trim() : "";
  if (!task) {
    return NextResponse.json(
      { error: "task (non-empty string) is required" },
      { status: 400 },
    );
  }
  const repoUrl = typeof body.repoUrl === "string" ? body.repoUrl.trim() : undefined;
  const branch = typeof body.branch === "string" ? body.branch.trim() : undefined;
  const maxSteps =
    typeof body.maxSteps === "number" && Number.isFinite(body.maxSteps)
      ? Math.trunc(body.maxSteps)
      : undefined;

  const result = await startAgentRun({
    userId: auth.user.id,
    task,
    repoUrl: repoUrl || undefined,
    branch: branch || undefined,
    maxSteps,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ id: result.id }, { status: 201 });
}
