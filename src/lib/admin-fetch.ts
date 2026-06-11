"use client";

/**
 * Browser-side wrapper for calls to admin-guarded endpoints
 * (`/api/constitution/{refresh,clear,test-pat}`).
 *
 * Behaviour:
 *  - On every call, attach an `x-admin-secret` header IF a key has
 *    been entered for this browser session.
 *  - If the server responds 401 (key missing or wrong), clear the
 *    stale key and propagate the response so the caller's UI can
 *    render an actionable hint.
 *  - If the server responds 503 ("admin endpoint locked — secret not
 *    configured"), surface the response as-is so the caller's UI can
 *    render an actionable hint. The key prompt is NOT shown because
 *    no secret value will satisfy the server.
 *
 * In development the admin guard is permissive, so this helper
 * behaves identically to a plain `fetch()` call — no prompt fires.
 *
 * The key lives ONLY in `sessionStorage` (cleared when the tab
 * closes) so we never persist a secret to long-term storage. The
 * secret is never logged.
 *
 * Shared plumbing lives in `src/lib/session-token-fetch.ts`.
 */

import { createSessionTokenClient } from "./session-token-fetch";

const client = createSessionTokenClient({
  storageKey: "warpcodx.adminSecret",
  headerName: "x-admin-secret",
  clearOnStatus: 401,
});

/**
 * Drop-in replacement for fetch() targeting an admin-guarded route.
 * Returns the final Response (after the optional retry).
 */
export async function adminFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return client.fetch(url, init);
}

/**
 * Test-only / settings-only utility — wipe the cached admin key
 * (e.g. after rotating the secret). Not exported via index; consumers
 * import directly.
 */
export function forgetAdminKey(): void {
  client.clear();
}
