"use client";

/**
 * Browser-side fetch wrapper for authenticated API routes.
 * Auth headers will be added here once Task #2 (auth + RLS) lands.
 * Until then this is a transparent passthrough so call-sites don't
 * need to change when the auth layer is wired.
 */
export async function authFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(url, init);
}
