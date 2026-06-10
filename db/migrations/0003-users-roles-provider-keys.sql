-- Migration 0003 — User roles + admin-managed provider keys
--
-- Adds:
--   1. profiles      — one row per auth.users; role is admin|user. Effective
--                      admin is decided by the ADMIN_EMAILS env at the app
--                      layer (env wins); this row is the persistent record /
--                      basis for future manual promotion.
--   2. provider_keys — admin-managed API keys per LLM provider, with a
--                      priority for the chat auto-switch fallback chain.
--                      SERVER-ONLY (service key); never exposed to the browser.
--                      RLS disabled to match the codebase's service-role access
--                      pattern; admin-gated in application code.
--
-- Non-destructive + idempotent + forward-only. Per-user chat isolation
-- (sessions.user_id) is a separate follow-up migration so this one is safe to
-- apply to the running deployment without touching existing chat data.

begin;

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  role        text not null default 'user' check (role in ('admin', 'user')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.profiles disable row level security;

create table if not exists public.provider_keys (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null check (provider in ('openrouter', 'openai', 'blackbox')),
  api_key     text not null,
  label       text not null default '',
  enabled     boolean not null default true,
  -- Lower priority is tried first in the auto-switch chain.
  priority    int not null default 100,
  -- Last failover diagnostic (e.g. "insufficient credit") for the admin UI.
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists provider_keys_chain_idx
  on public.provider_keys (enabled, priority, created_at);
alter table public.provider_keys disable row level security;

commit;
