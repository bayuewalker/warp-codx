import { NextResponse } from "next/server";
import { pingRepo, CONSTITUTION_REPO } from "@/lib/github";
import { isAdminAllowed } from "@/lib/adminGate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/constitution/test-pat
 *
 * Calls Octokit `repos.get` against the constitution repo to verify the
 * PAT is valid and has access. Returns OK / 401 / other. The PAT value
 * itself is never echoed. Gated behind isAdminAllowed in production —
 * the response is small but it's still a credential-validity probe.
 */
export async function GET(req: Request) {
  if (!isAdminAllowed(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!process.env.GITHUB_PAT_CONSTITUTION) {
    return NextResponse.json({
      ok: false,
      status: "missing_pat",
      detail: "GITHUB_PAT_CONSTITUTION env var is not set",
      repo: `${CONSTITUTION_REPO.owner}/${CONSTITUTION_REPO.name}`,
    });
  }
  const result = await pingRepo();
  return NextResponse.json({
    ok: result.status === "ok",
    status: result.status,
    detail: result.detail,
    repo: `${CONSTITUTION_REPO.owner}/${CONSTITUTION_REPO.name}`,
    checkedAt: new Date().toISOString(),
  });
}
