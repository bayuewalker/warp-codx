/**
 * Dev-only auth bypass — fixed user backing.
 *
 * When `NEXT_PUBLIC_SKIP_AUTH=true` the page + AppShell gates render
 * the chat shell without a Supabase session, but the API routes
 * still need a `user_id` to stamp on `sessions` inserts and RLS
 * policies still want a real `auth.users` row to exist. Rather than
 * pre-seed a fixed UUID via SQL (which fights Supabase's auth-table
 * triggers), we lazily create one through the admin API on first
 * use and cache the resolved id+email for the lifetime of the
 * server process.
 *
 * The admin call requires `SUPABASE_SERVICE_KEY`. If it's missing,
 * we return null and the caller falls through to a 401 — same
 * behavior as a real unauthenticated request, so a misconfigured
 * dev env produces the same observable failure as a normal one.
 *
 * MUST be removed before publishing to production. The companion
 * comments at the gate sites (`src/app/page.tsx`,
 * `src/components/AppShell.tsx`) say the same.
 */
import { createClient } from "@supabase/supabase-js";

const DEV_BYPASS_EMAIL = "dev-bypass@warp-codx.local";

type DevUser = { id: string; email: string };

let cached: DevUser | null = null;
let inflight: Promise<DevUser | null> | null = null;

/**
 * Single source of truth for whether the dev bypass is active. The
 * flag is *only* honored when NODE_ENV !== "production" so that an
 * accidental `NEXT_PUBLIC_SKIP_AUTH=true` baked into a prod build
 * (e.g. left in .replit, in a Vercel env, in a Replit deploy) is a
 * complete no-op. `next dev` runs with NODE_ENV=development and
 * `next start` after `next build` runs with NODE_ENV=production, so
 * this is the natural fence between dev and prod.
 *
 * Used by every gate site (server page, client AppShell, route
 * handlers via getRequestUser/getRequestSupabase). Update here, not
 * at the call sites.
 */
export function isAuthBypassActive(): boolean {
  return (
    process.env.NEXT_PUBLIC_SKIP_AUTH === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

export async function getDevBypassUser(): Promise<DevUser | null> {
  if (!isAuthBypassActive()) return null;
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_KEY;
      if (!url || !serviceKey) {
        console.error(
          "[dev-bypass] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_KEY missing — cannot resolve dev user.",
        );
        return null;
      }
      const admin = createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      // Look for an existing row first so we don't churn the
      // auth.users table on every server restart.
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      if (listErr) {
        console.error("[dev-bypass] listUsers failed:", listErr.message);
        return null;
      }
      const existing = list?.users.find((u) => u.email === DEV_BYPASS_EMAIL);
      if (existing) {
        cached = {
          id: existing.id,
          email: existing.email ?? DEV_BYPASS_EMAIL,
        };
        console.warn(
          `[dev-bypass] AUTH BYPASS ACTIVE — all API requests will run as ${cached.email} (${cached.id}). Remove NEXT_PUBLIC_SKIP_AUTH before publishing.`,
        );
        return cached;
      }

      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email: DEV_BYPASS_EMAIL,
          email_confirm: true,
          user_metadata: { dev_bypass: true },
        });
      if (createErr || !created?.user) {
        console.error(
          "[dev-bypass] createUser failed:",
          createErr?.message ?? "no user returned",
        );
        return null;
      }
      cached = {
        id: created.user.id,
        email: created.user.email ?? DEV_BYPASS_EMAIL,
      };
      console.warn(
        `[dev-bypass] AUTH BYPASS ACTIVE — created and using ${cached.email} (${cached.id}). Remove NEXT_PUBLIC_SKIP_AUTH before publishing.`,
      );
      return cached;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
