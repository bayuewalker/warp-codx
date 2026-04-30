import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
 * Use this on the client for read queries and Realtime subscriptions only.
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
 *
 * Next.js 14 patches the global `fetch` and aggressively caches GET requests
 * from route handlers — including the requests Supabase makes internally.
 * This causes stale reads (you insert a row in one request, then read it back
 * in the next request and see the cached empty result). We force `no-store`
 * on every Supabase HTTP call to opt out of the Next.js Data Cache.
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
