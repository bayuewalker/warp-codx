"use client";

/**
 * Browser-side fetch wrapper that attaches the Supabase session token so the
 * server can identify the user and enforce roles (admin/user). Falls back to
 * an unauthenticated request when no session/config is available, so guest
 * paths still work.
 */
import { getBrowserSupabase } from "./supabase";

export async function authFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  try {
    const { data } = await getBrowserSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  } catch {
    /* env not configured / no session — send unauthenticated */
  }
  return fetch(url, { ...init, headers });
}
