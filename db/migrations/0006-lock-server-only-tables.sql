-- Migration 0006 — Lock server-only tables behind RLS (deny-all to anon)
--
-- These tables are accessed exclusively from server code (src/lib/*) through
-- the service-role key, which bypasses RLS. With RLS DISABLED they were also
-- reachable through PostgREST with the public anon key, which Supabase's
-- security advisor flags:
--
--   * rls_disabled_in_public (ERROR) — app_settings, memories, skills,
--     profiles, provider_keys
--   * sensitive_columns_exposed (ERROR) — provider_keys.api_key (raw provider
--     API keys readable via the anon key!)
--
-- Enabling RLS with NO policies makes every table deny-all for the anon and
-- authenticated roles while the service-role key (used by all server routes)
-- continues to work unchanged. No application code reads these tables directly
-- from the browser, so this is transparent to the app and closes the advisors.
--
-- Idempotent + forward-only.

begin;

alter table public.app_settings  enable row level security;
alter table public.memories      enable row level security;
alter table public.skills        enable row level security;
alter table public.profiles      enable row level security;
alter table public.provider_keys enable row level security;

commit;
