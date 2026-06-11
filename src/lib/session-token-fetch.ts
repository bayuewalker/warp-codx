"use client";

/**
 * Shared factory for the browser-side admin-token fetch wrappers.
 *
 * Three surfaces (`admin-fetch.ts`, `issues-fetch.ts`, `prs-fetch.ts`)
 * follow the same contract with different names:
 *   - cache a secret in `sessionStorage` (never long-term storage)
 *   - attach it as a header on every call
 *   - clear the cached value when the server rejects it, propagating
 *     the response so the caller's UI shows an error state
 *   - optionally dispatch a window event on explicit SET / CLEAR so
 *     live consumers re-fetch
 *
 * The secret is never logged. Each module keeps its own storage key,
 * header name, and rejection status — this factory only removes the
 * triplicated plumbing.
 */

export type SessionTokenClientConfig = {
  /** sessionStorage key the secret lives under. */
  storageKey: string;
  /** Request header the secret is sent as. */
  headerName: string;
  /** Response status that invalidates the cached secret (401 or 403). */
  clearOnStatus: number;
  /** Optional window event dispatched on explicit SET / CLEAR. */
  changeEvent?: string;
};

export type SessionTokenClient = {
  /** Cached secret, or null when unset / storage unavailable. */
  read(): string | null;
  /** Remove the cached secret. Never throws. */
  clear(): void;
  /** True iff a non-empty secret is currently cached. */
  has(): boolean;
  /** Trimmed write (empty clears); dispatches the change event. */
  set(value: string): void;
  /** Clear + dispatch the change event. */
  forget(): void;
  /**
   * Drop-in replacement for `fetch()` against the guarded routes.
   * Attaches the header when a secret is cached and clears the cache
   * on `clearOnStatus` before returning the final Response.
   */
  fetch(url: string, init?: RequestInit): Promise<Response>;
};

export function createSessionTokenClient(
  config: SessionTokenClientConfig,
): SessionTokenClient {
  const { storageKey, headerName, clearOnStatus, changeEvent } = config;

  function emitChange(): void {
    if (typeof window === "undefined" || !changeEvent) return;
    try {
      window.dispatchEvent(new CustomEvent(changeEvent));
    } catch {
      /* noop */
    }
  }

  function read(): string | null {
    if (typeof window === "undefined") return null;
    try {
      return window.sessionStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }

  function write(value: string): void {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(storageKey, value);
    } catch {
      /* private mode etc. — silently degrade */
    }
  }

  function clear(): void {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      /* noop */
    }
  }

  function attachHeader(
    init: RequestInit | undefined,
    token: string | null,
  ): RequestInit {
    const headers = new Headers(init?.headers);
    if (token) headers.set(headerName, token);
    return { ...init, headers };
  }

  return {
    read,
    clear,
    has(): boolean {
      const t = read();
      return t !== null && t !== "";
    },
    set(value: string): void {
      const trimmed = value.trim();
      if (trimmed) write(trimmed);
      else clear();
      emitChange();
    },
    forget(): void {
      clear();
      emitChange();
    },
    async fetch(url: string, init?: RequestInit): Promise<Response> {
      const res = await fetch(url, attachHeader(init, read()));
      if (res.status === clearOnStatus) {
        // Stale secret — clear it and propagate the response so the
        // caller's UI shows an error state. The operator re-enters the
        // secret via Settings (no intrusive window.prompt()).
        clear();
      }
      return res;
    },
  };
}
