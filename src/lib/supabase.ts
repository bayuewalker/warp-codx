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
 */
export function getServerSupabase(): SupabaseClient {
  return createClient(
    assertEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL),
    assertEnv("SUPABASE_SERVICE_KEY", process.env.SUPABASE_SERVICE_KEY),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
