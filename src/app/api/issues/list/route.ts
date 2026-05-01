/**
 * Phase 3b — GET /api/issues/list
 *
 * Returns up to 50 most-recent `forge-task`-labeled issues from
 * `bayuewalker/walkermind-os` (open + closed, newest first). Powers
 * the in-drawer Issues view.
 *
 * Response (200):
 *   { issues: Array<{
 *       number, title, state, url, labels[], createdAt
 *     }> }
 *
 * Failure (500):
 *   { error: "<sanitized github_list_<status> message>" }
 *
 * The PAT is never logged or returned. GitHub is the source of truth
 * for issue state — we intentionally do NOT cross-reference the local
 * `issues_created` audit table here, since the local table doesn't
 * track open/closed transitions.
 */
import { NextResponse } from "next/server";
import { listForgeIssues } from "@/lib/github-issues";
import { isAdminAllowed } from "@/lib/adminGate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  // Phase 3b — admin gate. Dev / preview is permissive so the in-app
  // IssuesView works locally without any header. In production a public
  // visitor must supply `x-warp-admin-token`. The list response itself
  // is non-sensitive (already public on github.com) but each call still
  // burns a PAT-backed API quota, so gating it is appropriate.
  if (!isAdminAllowed(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const issues = await listForgeIssues();
    return NextResponse.json({ issues });
  } catch (err) {
    const message = err instanceof Error ? err.message : "github list failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
