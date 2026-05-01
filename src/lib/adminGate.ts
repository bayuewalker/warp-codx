/**
 * Phase 3a — single-tenant admin gate for sensitive constitution endpoints.
 *
 * Allows the request when EITHER:
 *   - The process is not running in production (dev / preview), OR
 *   - The env var `DEBUG_CONSTITUTION_STATS=1` is set, OR
 *   - The request carries `x-warp-admin-token` matching `WARP_ADMIN_TOKEN`.
 *
 * Used by /api/constitution/clear and /api/constitution/test-pat to prevent
 * unauthenticated cache wipes and PAT-validity probes on a public deploy.
 * /api/constitution/refresh is intentionally NOT gated — it powers the
 * user-facing slash command and the Settings panel.
 */
export function isAdminAllowed(req: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.DEBUG_CONSTITUTION_STATS === "1") return true;
  const expected = process.env.WARP_ADMIN_TOKEN;
  if (expected && expected.length > 0) {
    const got = req.headers.get("x-warp-admin-token");
    if (got && got === expected) return true;
  }
  return false;
}
