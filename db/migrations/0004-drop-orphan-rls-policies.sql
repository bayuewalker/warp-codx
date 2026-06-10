-- Migration 0004 — Drop orphan RLS policies on sessions + messages
--
-- Fixes the Supabase advisor "Policy Exists RLS Disabled" (CRITICAL) on
-- public.messages and public.sessions: migration 0001 created per-user RLS
-- policies, but a later change (removing the auth gate) DISABLED RLS on those
-- tables, leaving the policies orphaned — present but not enforced.
--
-- The app is currently single-tenant and accesses these tables exclusively via
-- the service-role key (which bypasses RLS), while the browser uses the anon
-- key only for Realtime. Enabling RLS now would make the anon Realtime
-- subscription return zero rows and break live chat updates. So the correct
-- fix for the present architecture is to drop the orphan policies and keep RLS
-- disabled. Per-user isolation will reintroduce policies (and enable RLS with a
-- properly authenticated browser client) in a dedicated follow-up.
--
-- Idempotent + forward-only.

begin;

drop policy if exists messages_select_own  on public.messages;
drop policy if exists messages_insert_own  on public.messages;
drop policy if exists messages_update_own  on public.messages;
drop policy if exists messages_delete_own  on public.messages;

drop policy if exists sessions_select_own  on public.sessions;
drop policy if exists sessions_insert_own  on public.sessions;
drop policy if exists sessions_update_own  on public.sessions;
drop policy if exists sessions_delete_own  on public.sessions;

alter table public.messages disable row level security;
alter table public.sessions disable row level security;

commit;
