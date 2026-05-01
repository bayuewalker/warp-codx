/**
 * Phase 3c — GET /api/prs/list
 *
 * Returns up to 30 most-recently-updated open PRs on
 * `bayuewalker/walkermind-os` whose head branch starts with `WARP/`.
 * Powers both the in-chat PRListCard and the drawer PRListView.
 *
 * Response (200):
 *   {
 *     prs: ListedPR[],
 *     truncated: boolean   // true when GitHub returned a full page
 *   }
 *
 * Failure (500):
 *   { error: "<sanitized github_list_<status> message>" }
 *
 * AUTH GATE — admin-gated, mirroring `/api/issues/list` behavior:
 *   - Dev / preview: permissive (no header needed). The browser uses
 *     `prsFetch()` which sends nothing extra.
 *   - Production: requires `x-warp-admin-token`. Each call burns a
 *     PAT-backed API quota, so the gate matches the rest of the
 *     PAT-fronted surface. The plan called this route ungated, but
 *     the actual `/api/issues/list` is admin-gated; matching the
 *     real behavior keeps the public deploy quota safe.
 *
 * The PAT is never logged or returned. GitHub is the source of truth
 * for state — no local table cross-reference here.
 */
import { NextResponse } from "next/server";
import { listWarpPRs } from "@/lib/github-prs";
import { isAdminAllowed } from "@/lib/adminGate";
import { statusFromAdapterError } from "@/lib/route-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isAdminAllowed(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const result = await listWarpPRs();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "github list failed";
    // Adapter errors arrive sanitized as `github_list_<status>: ...`.
    // Map known 4xx codes back to the matching HTTP status so the
    // operator client sees "Bad credentials" as 401, not 500. See
    // `src/lib/route-error.ts` and Task #35 route tests.
    return NextResponse.json(
      { error: message },
      { status: statusFromAdapterError(message) },
    );
  }
}
