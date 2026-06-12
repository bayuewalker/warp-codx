/**
 * Workspace file contents.
 *
 *   GET /api/workspace/file?path=<file>           → { path, content }
 *   PUT /api/workspace/file { path, content }      → save (overwrite)
 *
 * The editor reads on open and writes on save. `path` is validated to stay
 * inside the workspace; a binary/oversized read is rejected with a clear error
 * rather than streaming megabytes into the browser.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roles";
import { unauthorized } from "@/lib/route-helpers";
import { connectSandbox, WorkspaceNotReadyError } from "@/lib/agent/workspace";
import { safeWorkspacePath } from "@/lib/agent/workspace-path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Cap a single editable file at 1 MB — past that it's not an editor case. */
const MAX_FILE_BYTES = 1_000_000;

function notReady(err: unknown): NextResponse | null {
  if (err instanceof WorkspaceNotReadyError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  return null;
}

export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const rel = safeWorkspacePath(url.searchParams.get("path"));
  if (!rel) {
    return NextResponse.json({ error: "Invalid or missing path" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandbox(user.id);
    const content = await sandbox.readFile(rel);
    if (content.length > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "File too large to open in the editor (> 1 MB)." },
        { status: 413 },
      );
    }
    // A NUL byte is the cheap, reliable signal that this is a binary file.
    if (content.includes("\0")) {
      return NextResponse.json(
        { error: "Binary file — not editable as text." },
        { status: 415 },
      );
    }
    return NextResponse.json({ path: rel, content });
  } catch (err) {
    const nr = notReady(err);
    if (nr) return nr;
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();

  let body: { path?: unknown; content?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rel = safeWorkspacePath(body.path);
  if (!rel) {
    return NextResponse.json({ error: "Invalid or missing path" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content must be a string" }, { status: 400 });
  }
  if (body.content.length > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File exceeds 1 MB limit." }, { status: 413 });
  }

  try {
    const sandbox = await connectSandbox(user.id);
    await sandbox.writeFile(rel, body.content);
    return NextResponse.json({ ok: true, path: rel });
  } catch (err) {
    const nr = notReady(err);
    if (nr) return nr;
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
