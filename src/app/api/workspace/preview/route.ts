/**
 * Workspace preview (the webview).
 *
 *   GET  /api/workspace/preview                  → last-known preview URL/port
 *   POST /api/workspace/preview { command?, port? } → start a dev server + URL
 *
 * POST launches the dev server detached (so it outlives the request) and
 * resolves the public URL that proxies its port. The resolved URL/port are
 * cached on the workspace record so a reload restores the webview.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roles";
import { unauthorized } from "@/lib/route-helpers";
import { connectSandbox, WorkspaceNotReadyError } from "@/lib/agent/workspace";
import { getWorkspaceRecord, upsertWorkspaceRecord } from "@/lib/agent/workspace-store";
import {
  DEFAULT_PREVIEW_PORT,
  startPreview,
} from "@/lib/agent/workspace-preview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Default dev command — bind to 0.0.0.0 so the runner's proxy can reach it. */
const DEFAULT_COMMAND = "npm run dev";

export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const record = await getWorkspaceRecord(user.id);
  return NextResponse.json({
    url: record?.preview_url ?? null,
    port: record?.preview_port ?? null,
  });
}

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();

  let body: { command?: unknown; port?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const command =
    typeof body.command === "string" && body.command.trim()
      ? body.command.trim()
      : DEFAULT_COMMAND;
  const port =
    typeof body.port === "number" && Number.isInteger(body.port) && body.port > 0
      ? body.port
      : DEFAULT_PREVIEW_PORT;

  try {
    const sandbox = await connectSandbox(user.id);
    const result = await startPreview(sandbox, { command, port });
    await upsertWorkspaceRecord(user.id, {
      preview_port: result.port,
      preview_url: result.url,
      touchActivity: true,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof WorkspaceNotReadyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
