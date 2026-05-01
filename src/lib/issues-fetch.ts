"use client";

/**
 * Phase 3b — browser-side wrapper for `/api/issues/{create,list}`.
 *
 * Mirrors the persistence + retry UX of `src/lib/admin-fetch.ts`, but
 * aligned to the `adminGate` server contract:
 *   - sends `x-warp-admin-token` (not `x-admin-secret`)
 *   - reads/persists `WARP_ADMIN_TOKEN` (not `CONSTITUTION_ADMIN_SECRET`)
 *   - reacts to 403 (not 401)
 *
 * In dev / preview the server gate is permissive, so this helper
 * behaves identically to a plain `fetch()` — no prompt fires.
 *
 * In production, on the first 403 we prompt the operator once for the
 * admin token, persist it in `sessionStorage` (NEVER long-term storage),
 * and retry the request. The token is never logged.
 *
 * Phase 3a's `admin-fetch.ts` is intentionally left untouched — these
 * are two distinct admin surfaces with different secret names and
 * status conventions.
 */

const STORAGE_KEY = "warpcodx.issuesAdminToken";

/** Fires on explicit SET / CLEAR from Settings — listeners refetch. */
export const ISSUES_ADMIN_TOKEN_EVENT =
  "warpcodx:issues-admin-token-changed";

/** Fires after a 403 auto-retry write — Settings badge sync only. */
export const ISSUES_ADMIN_TOKEN_STATUS_EVENT =
  "warpcodx:issues-admin-token-status";

function emitChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(ISSUES_ADMIN_TOKEN_EVENT));
  } catch {
    /* noop */
  }
}

function emitStatus(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(ISSUES_ADMIN_TOKEN_STATUS_EVENT));
  } catch {
    /* noop */
  }
}

function readToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeToken(value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* private mode etc. — silently degrade */
  }
}

function clearToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

function attachHeader(
  init: RequestInit | undefined,
  token: string | null,
): RequestInit {
  const headers = new Headers(init?.headers);
  if (token) headers.set("x-warp-admin-token", token);
  return { ...init, headers };
}

/**
 * Drop-in replacement for `fetch()` targeting `/api/issues/*` routes.
 * Returns the final Response (after the optional retry).
 */
export async function issuesFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const initialToken = readToken();
  let res = await fetch(url, attachHeader(init, initialToken));

  if (res.status === 403) {
    // Wrong / missing token. Clear stale value and prompt once.
    // No `emitChange()` here — emitting would wake sibling listeners
    // mid-flight and race with `clearToken()` on the new token.
    clearToken();
    const promptedRaw =
      typeof window !== "undefined"
        ? window.prompt("Enter WARP_ADMIN_TOKEN to perform this action:")
        : null;
    const prompted = promptedRaw ? promptedRaw.trim() : "";
    if (!prompted) return res; // operator cancelled — propagate 403
    writeToken(prompted);
    res = await fetch(url, attachHeader(init, prompted));
    emitStatus(); // Settings badge sync only — no refresh trigger.
  }

  return res;
}

/** True iff an issues admin token is currently cached in sessionStorage. */
export function hasIssuesAdminToken(): boolean {
  const t = readToken();
  return t !== null && t !== "";
}

/**
 * Settings-drawer entry point. Empty input is treated as a clear.
 * Always emits a change event so live consumers can re-fetch.
 */
export function setIssuesAdminToken(value: string): void {
  const trimmed = value.trim();
  if (trimmed) writeToken(trimmed);
  else clearToken();
  emitChange();
}

/**
 * Test-only / settings-only utility — wipe the cached admin token
 * (e.g. after rotating the secret). Not used by the main flows.
 */
export function forgetIssuesAdminToken(): void {
  clearToken();
  emitChange();
}
