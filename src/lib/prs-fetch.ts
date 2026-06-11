"use client";

/**
 * Phase 3c — browser-side wrapper for `/api/prs/*` routes.
 *
 * Mirrors `src/lib/issues-fetch.ts` exactly:
 *   - sends `x-warp-admin-token` (matches `adminGate` server contract)
 *   - reads/persists `WARP_ADMIN_TOKEN` in `sessionStorage`
 *   - on 403, clears the stale token and propagates the response
 *   - in dev / preview the gate is permissive, so this behaves like
 *     a plain `fetch()` and no prompt fires
 *
 * Distinct sessionStorage key from `issues-fetch.ts` so the two
 * surfaces can in principle hold different tokens; in practice they
 * are the same secret. Never logged.
 *
 * Shared plumbing lives in `src/lib/session-token-fetch.ts`.
 */

import { createSessionTokenClient } from "./session-token-fetch";

/** Fires on explicit SET / CLEAR from Settings — listeners refetch. */
export const PRS_ADMIN_TOKEN_EVENT = "warpcodx:prs-admin-token-changed";

/** Fires after a 403 auto-retry write — Settings badge sync only. */
export const PRS_ADMIN_TOKEN_STATUS_EVENT =
  "warpcodx:prs-admin-token-status";

const client = createSessionTokenClient({
  storageKey: "warpcodx.prsAdminToken",
  headerName: "x-warp-admin-token",
  clearOnStatus: 403,
  changeEvent: PRS_ADMIN_TOKEN_EVENT,
});

/**
 * Drop-in replacement for `fetch()` targeting `/api/prs/*` routes.
 * Returns the final Response (after the optional retry).
 */
export async function prsFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return client.fetch(url, init);
}

/** True iff a PRs admin token is currently cached in sessionStorage. */
export function hasPRsAdminToken(): boolean {
  return client.has();
}

/**
 * Settings-drawer entry point. Empty input is treated as a clear.
 * Always emits a change event so live consumers can re-fetch.
 */
export function setPRsAdminToken(value: string): void {
  client.set(value);
}

export function forgetPRsAdminToken(): void {
  client.forget();
}
