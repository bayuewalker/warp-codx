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
 */

const PRS_KEY = "warpcodx.prsAdminToken";
const ISSUES_KEY = "warpcodx.issuesAdminToken";

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
}

function clearBoth(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PRS_KEY);
    window.sessionStorage.removeItem(ISSUES_KEY);
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
    return Boolean((a && a !== "") || (b && b !== ""));
  } catch {
    return false;
  }
}
