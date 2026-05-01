"use client";

/**
 * Browser-side wrapper for calls to admin-guarded endpoints
 * (`/api/constitution/{refresh,clear,test-pat}`).
 *
 * Behaviour:
 *  - On every call, attach an `x-admin-secret` header IF a key has
 *    been entered for this browser session.
 *  - If the server responds 401 (key missing or wrong), prompt the
 *    operator for the key, persist it in `sessionStorage`, and retry
 *    the request ONCE with the new key.
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
 */

const STORAGE_KEY = "warpcodx.adminSecret";

function readKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeKey(value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* private mode etc. — silently degrade */
  }
}

function clearKey(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

function attachHeader(init: RequestInit | undefined, key: string | null): RequestInit {
  const headers = new Headers(init?.headers);
  if (key) headers.set("x-admin-secret", key);
  return { ...init, headers };
}

/**
 * Drop-in replacement for fetch() targeting an admin-guarded route.
 * Returns the final Response (after the optional retry).
 */
export async function adminFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const initialKey = readKey();
  let res = await fetch(url, attachHeader(init, initialKey));

  if (res.status === 401) {
    // Wrong / missing key. Clear any stale value and prompt once.
    clearKey();
    const promptedRaw =
      typeof window !== "undefined"
        ? window.prompt(
            "Enter CONSTITUTION_ADMIN_SECRET to perform this action:",
          )
        : null;
    const prompted = promptedRaw ? promptedRaw.trim() : "";
    if (!prompted) return res; // operator cancelled — propagate 401
    writeKey(prompted);
    res = await fetch(url, attachHeader(init, prompted));
  }

  return res;
}

/**
 * Test-only / settings-only utility — wipe the cached admin key
 * (e.g. after rotating the secret). Not exported via index; consumers
 * import directly.
 */
export function forgetAdminKey(): void {
  clearKey();
}
