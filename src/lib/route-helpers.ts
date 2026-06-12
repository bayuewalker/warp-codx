/**
 * Small shared helpers for App Router API routes (server-only).
 * Centralizes the auth-gate response boilerplate that several route
 * files previously redefined locally. Response shapes are unchanged.
 */
import { NextResponse } from "next/server";
import type { requireAdmin } from "./roles";

/** Standard 401 for unauthenticated callers (per-user isolation gate). */
export function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "Authentication required" },
    { status: 401 },
  );
}

/**
 * Map a `requireAdmin()` result to its error response, or null when
 * the caller is an authenticated admin and the route may proceed.
 */
export function adminGateResponse(
  result: Awaited<ReturnType<typeof requireAdmin>>,
): NextResponse | null {
  if ("error" in result) {
    const status = result.error === "unauthenticated" ? 401 : 403;
    return NextResponse.json({ error: result.error }, { status });
  }
  return null;
}
