"use client";

/**
 * Task #25 — combined entry point for the WARP admin token used by
 * BOTH the PRs panel (`prs-fetch.ts`) and the Issues panel
 * (`issues-fetch.ts`). The two surfaces use the same secret in
 * practice; this helper writes both sessionStorage keys at once
 * and fires a SINGLE change event so each subscribed view refreshes
 * at most once per operator action (no duplicate refresh storms).
 *
 * Per-key APIs in `prs-fetch.ts` / `issues-fetch.ts` remain the
 * canonical primitives — used by the 403 auto-retry path and any
 * caller that only touches one surface.
 *
 * WARP/ui-fix-r2 — token now ALSO persists in `localStorage` under
 * `warp_admin_token` so it survives a hard refresh / new tab. The
 * dual sessionStorage keys remain the runtime read path for
 * `prs-fetch` / `issues-fetch` (untouched by this change). On first
 * import in the browser we rehydrate sessionStorage from
 * localStorage so the operator only has to enter the token once
 * per browser, not once per tab.
 */

const PRS_KEY = "warpcodx.prsAdminToken";
const ISSUES_KEY = "warpcodx.issuesAdminToken";
const LOCAL_KEY = "warp_admin_token";

/** Single coalesced event — listeners refetch exactly once. */
export const ADMIN_TOKEN_EVENT = "warpcodx:admin-token-changed";

function writeBoth(value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PRS_KEY, value);
    window.sessionStorage.setItem(ISSUES_KEY, value);
  } catch {
    /* private mode etc. — silently degrade */
  }
  try {
    window.localStorage.setItem(LOCAL_KEY, value);
  } catch {
    /* private mode etc. — silently degrade */
  }
}

function clearBoth(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PRS_KEY);
    window.sessionStorage.removeItem(ISSUES_KEY);
  } catch {
    /* noop */
  }
  try {
    window.localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* noop */
  }
}

function emit(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(ADMIN_TOKEN_EVENT));
  } catch {
    /* noop */
  }
}

/**
 * Copy the persisted localStorage value (if any) into the dual
 * sessionStorage keys whenever sessionStorage is empty. Safe to call
 * repeatedly — a no-op when sessionStorage is already populated, so
 * a 403-auto-retry write isn't clobbered by a stale localStorage
 * entry. Silently swallows storage exceptions (private mode etc.).
 */
export function rehydrateAdminTokenFromLocalStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const persisted = window.localStorage.getItem(LOCAL_KEY);
    if (!persisted) return;
    const haveSession =
      window.sessionStorage.getItem(PRS_KEY) ||
      window.sessionStorage.getItem(ISSUES_KEY);
    if (haveSession) return;
    window.sessionStorage.setItem(PRS_KEY, persisted);
    window.sessionStorage.setItem(ISSUES_KEY, persisted);
  } catch {
    /* noop */
  }
}

// Run rehydrate at first browser import. ConstitutionSettings is
// statically imported by AppShell, which is the page entry point, so
// this side-effect fires before any prs-fetch / issues-fetch call has
// a chance to read sessionStorage.
if (typeof window !== "undefined") {
  rehydrateAdminTokenFromLocalStorage();
}

/**
 * Write `value` to both PRs and Issues admin-token storage keys.
 * Empty / blank input is treated as a clear.
 */
export function setAllAdminTokens(value: string): void {
  const trimmed = value.trim();
  if (trimmed) writeBoth(trimmed);
  else clearBoth();
  emit();
}

/** Clear both PRs and Issues admin-token storage keys. */
export function clearAllAdminTokens(): void {
  clearBoth();
  emit();
}

/** True iff either admin-token storage key is set. */
export function hasAnyAdminToken(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const a = window.sessionStorage.getItem(PRS_KEY);
    const b = window.sessionStorage.getItem(ISSUES_KEY);
    if ((a && a !== "") || (b && b !== "")) return true;
  } catch {
    /* fall through to localStorage probe */
  }
  try {
    const persisted = window.localStorage.getItem(LOCAL_KEY);
    return Boolean(persisted && persisted !== "");
  } catch {
    return false;
  }
}
