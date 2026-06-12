/**
 * GET /api/workspace/files?path=<dir> → entries directly under a workspace dir.
 *
 * Powers the IDE file tree, which lazily expands one directory at a time. Each
 * entry carries its full workspace-relative path so the client can read it or
 * expand it without re-deriving paths. `path` is validated to stay inside the
 * workspace before it ever reaches the sandbox.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roles";
import { unauthorized } from "@/lib/route-helpers";
import { connectSandbox, WorkspaceNotReadyError } from "@/lib/agent/workspace";
import { safeWorkspacePath } from "@/lib/agent/workspace-path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const rel = safeWorkspacePath(url.searchParams.get("path") ?? "");
  if (rel === null) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const sandbox = await connectSandbox(user.id);
    const names = await sandbox.listDir(rel || ".");
    // listDir marks directories with a trailing slash; split that back out and
    // sort dirs-first, then alphabetically — the conventional explorer order.
    const entries = names
      .map((name) => {
        const isDir = name.endsWith("/");
        const clean = isDir ? name.slice(0, -1) : name;
        return {
          name: clean,
          isDir,
          path: rel ? `${rel}/${clean}` : clean,
        };
      })
      .sort((a, b) =>
        a.isDir === b.isDir
          ? a.name.localeCompare(b.name)
          : a.isDir
            ? -1
            : 1,
      );
    return NextResponse.json({ path: rel, entries });
  } catch (err) {
    if (err instanceof WorkspaceNotReadyError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
