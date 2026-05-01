import { type NextRequest, NextResponse } from "next/server";

/**
 * Shared-secret guard for the constitution mutation/diagnostic
 * endpoints. The secret is read from `CONSTITUTION_ADMIN_SECRET`
 * server-side only.
 *
 * Behaviour:
 *   - In development (NODE_ENV !== "production"), the guard is
 *     permissive — endpoints work without a secret so the operator
 *     can iterate locally without setup friction.
 *   - In production, if the env var is unset the endpoints are
 *     LOCKED (returns 503) — fail-closed so a forgotten secret
 *     doesn't expose a public cache-clear button.
 *   - In production with the env var set, the request must include
 *     the matching `x-admin-secret` header.
 *
 * Returns `null` when the request passes; otherwise a 401/503
 * NextResponse the caller should return directly.
 *
 * SECURITY: never logs the secret value, never echoes it to the
 * response body, never includes it in error messages.
 */
export function requireAdmin(req: NextRequest): NextResponse | null {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return null;

  const expected = process.env.CONSTITUTION_ADMIN_SECRET;
  if (!expected) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Admin endpoint locked — CONSTITUTION_ADMIN_SECRET not configured",
      },
      { status: 503 },
    );
  }

  const provided = req.headers.get("x-admin-secret");
  if (!provided || provided !== expected) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }
  return null;
}
