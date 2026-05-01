"use client";

/**
 * Phase 3c — browser-side wrapper for `/api/prs/*` routes.
 *
 * Mirrors `src/lib/issues-fetch.ts` exactly:
 *   - sends `x-warp-admin-token` (matches `adminGate` server contract)
 *   - reads/persists `WARP_ADMIN_TOKEN` in `sessionStorage`
 *   - on 403, prompts the operator once for the token, persists it,
 *     and retries the request once
 *   - in dev / preview the gate is permissive, so this behaves like
 *     a plain `fetch()` and no prompt fires
 *
 * Distinct sessionStorage key from `issues-fetch.ts` so the two
 * surfaces can in principle hold different tokens; in practice they
 * are the same secret. Never logged.
 */

const STORAGE_KEY = "warpcodx.prsAdminToken";

/** Fires on explicit SET / CLEAR from Settings — listeners refetch. */
export const PRS_ADMIN_TOKEN_EVENT = "warpcodx:prs-admin-token-changed";

/** Fires after a 403 auto-retry write — Settings badge sync only. */
export const PRS_ADMIN_TOKEN_STATUS_EVENT =
  "warpcodx:prs-admin-token-status";

function emitChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(PRS_ADMIN_TOKEN_EVENT));
  } catch {
    /* noop */
  }
}

function emitStatus(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(PRS_ADMIN_TOKEN_STATUS_EVENT));
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
 * Drop-in replacement for `fetch()` targeting `/api/prs/*` routes.
 * Returns the final Response (after the optional retry).
 */
export async function prsFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const initialToken = readToken();
  let res = await fetch(url, attachHeader(init, initialToken));

  if (res.status === 403) {
    // No `emitChange()` here — emitting would wake sibling listeners
    // mid-flight and race with `clearToken()` on the new token.
    clearToken();
    const promptedRaw =
      typeof window !== "undefined"
        ? window.prompt("Enter WARP_ADMIN_TOKEN to perform this action:")
        : null;
    const prompted = promptedRaw ? promptedRaw.trim() : "";
    if (!prompted) return res;
    writeToken(prompted);
    res = await fetch(url, attachHeader(init, prompted));
    emitStatus(); // Settings badge sync only — no refresh trigger.
  }

  return res;
}

/** True iff a PRs admin token is currently cached in sessionStorage. */
export function hasPRsAdminToken(): boolean {
  const t = readToken();
  return t !== null && t !== "";
}

/**
 * Settings-drawer entry point. Empty input is treated as a clear.
 * Always emits a change event so live consumers can re-fetch.
 */
export function setPRsAdminToken(value: string): void {
  const trimmed = value.trim();
  if (trimmed) writeToken(trimmed);
  else clearToken();
  emitChange();
}

export function forgetPRsAdminToken(): void {
  clearToken();
  emitChange();
}
