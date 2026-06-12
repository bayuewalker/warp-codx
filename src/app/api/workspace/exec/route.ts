/**
 * POST /api/workspace/exec { command, cwd? } → { stdout, exitCode }
 *
 * The IDE terminal: run one shell command in the workspace and return its
 * combined output. This is request/response (not a live PTY) — long-lived
 * servers belong on /api/workspace/preview, which launches them detached.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roles";
import { unauthorized } from "@/lib/route-helpers";
import { connectSandbox, WorkspaceNotReadyError } from "@/lib/agent/workspace";
import { safeWorkspacePath } from "@/lib/agent/workspace-path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Per-command ceiling for the terminal (ms) — a guard against a wedged shell. */
const EXEC_TIMEOUT_MS = 120_000;
/** Cap output returned to the browser. */
const MAX_OUTPUT = 100_000;

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();

  let body: { command?: unknown; cwd?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (!command) {
    return NextResponse.json({ error: "command is required" }, { status: 400 });
  }
  // cwd is optional but, when given, must stay inside the workspace.
  let cwd: string | undefined;
  if (body.cwd !== undefined && body.cwd !== null && body.cwd !== "") {
    const safe = safeWorkspacePath(body.cwd);
    if (safe === null) {
      return NextResponse.json({ error: "Invalid cwd" }, { status: 400 });
    }
    cwd = safe || undefined;
  }

  try {
    const sandbox = await connectSandbox(user.id);
    const res = await sandbox.exec(command, { cwd, timeoutMs: EXEC_TIMEOUT_MS });
    const combined =
      (res.stdout ?? "") + (res.stderr ? `\n${res.stderr}` : "");
    const output =
      combined.length > MAX_OUTPUT
        ? `${combined.slice(0, MAX_OUTPUT)}\n…[truncated]`
        : combined;
    return NextResponse.json({ output, exitCode: res.exitCode });
  } catch (err) {
    if (err instanceof WorkspaceNotReadyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
