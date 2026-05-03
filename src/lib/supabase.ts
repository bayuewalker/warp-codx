import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getDevBypassUser, isAuthBypassActive } from "./dev-bypass";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Task #2 — Authenticated server client.
 *
 * Returns a Supabase client that uses the anon key plus the caller's
 * bearer token, so all queries run as the signed-in user and RLS
 * policies apply. Returns `null` if no token is present so the caller
 * can respond with 401.
 *
 * Under the dev bypass (NEXT_PUBLIC_SKIP_AUTH=true, NODE_ENV !== production),
 * falls back to the service-role client so unauthenticated API requests
 * succeed without a bearer token. Real bearer tokens always win.
 */
export function getRequestSupabase(
  authHeader: string | null | undefined,
): SupabaseClient | null {
  if (authHeader) {
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : authHeader.trim();
    if (token) {
      const noStoreFetch: typeof fetch = (input, init) =>
        fetch(input, { ...init, cache: "no-store" });
      return createClient(
        assertEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL),
        assertEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", SUPABASE_ANON_KEY),
        {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: noStoreFetch,
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      );
    }
  }

  // Dev-only bypass — fall back to service-role when no bearer token
  // is present and the bypass is active. RLS is intentionally bypassed
  // (the database is single-tenant in dev). Hard-gated on NODE_ENV !==
  // "production" inside isAuthBypassActive(). MUST be off in prod.
  if (isAuthBypassActive()) {
    return getServerSupabase();
  }
  return null;
}

/**
 * Resolve the caller's identity from an Authorization header.
 * Returns null if no valid session and bypass is not active.
 */
export async function getRequestUser(
  authHeader: string | null | undefined,
): Promise<{ id: string; email: string | null } | null> {
  if (authHeader) {
    const client = getRequestSupabase(authHeader);
    if (client) {
      const { data } = await client.auth.getUser();
      if (data?.user) {
        return { id: data.user.id, email: data.user.email ?? null };
      }
    }
  }
  if (isAuthBypassActive()) {
    return getDevBypassUser();
  }
  return null;
}

function assertEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `See .env.example.`,
    );
  }
  return value;
}

/**
 * Browser-safe Supabase client using the anon key.
 */
let _browserClient: SupabaseClient | null = null;
export function getBrowserSupabase(): SupabaseClient {
  if (_browserClient) return _browserClient;
  _browserClient = createClient(
    assertEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL),
    assertEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", SUPABASE_ANON_KEY),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 10 } },
    },
  );
  return _browserClient;
}

/**
 * Server-only Supabase client using the service-role key.
 * Bypasses RLS. Never import this from a client component.
 */
export function getServerSupabase(): SupabaseClient {
  const noStoreFetch: typeof fetch = (input, init) =>
    fetch(input, { ...init, cache: "no-store" });

  return createClient(
    assertEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL),
    assertEnv("SUPABASE_SERVICE_KEY", process.env.SUPABASE_SERVICE_KEY),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: noStoreFetch },
    },
  );
}
