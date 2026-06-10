-- Migration 0002 — Workspace features: custom instructions, memory, skills
--
-- Replaces the GitHub "constitution" system-prompt source with three
-- operator-owned building blocks that the chat route composes into the
-- system prompt on every turn:
--
--   1. app_settings.custom_instructions — a single global instruction blob
--      (this deployment is single-tenant; see supabase.sql).
--   2. memories — durable facts/preferences. `manual` rows are added by the
--      operator; `auto` rows are extracted from chat and land as `pending`
--      for review before they go `active`.
--   3. skills — Claude-style SKILL.md modules. Enabled skills are advertised
--      to the model every turn; the full body is injected when the user's
--      message matches the skill's name or triggers.
--
-- Idempotent + forward-only. Safe to paste into the Supabase SQL editor.
-- RLS is left DISABLED to match the existing single-tenant chat tables
-- (only the Next.js server, using the service-role key, ever reads/writes).

begin;

create extension if not exists "pgcrypto";

-- 1. Custom instructions — enforced singleton (id is always 1).
create table if not exists public.app_settings (
  id                  smallint primary key default 1,
  custom_instructions text not null default '',
  updated_at          timestamptz not null default now(),
  constraint app_settings_singleton check (id = 1)
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;
alter table public.app_settings disable row level security;

-- 2. Memory entries.
create table if not exists public.memories (
  id          uuid primary key default gen_random_uuid(),
  content     text not null,
  source      text not null default 'manual' check (source in ('manual', 'auto')),
  status      text not null default 'active' check (status in ('active', 'pending', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists memories_status_idx
  on public.memories (status, created_at desc);
alter table public.memories disable row level security;

-- 3. Installed skills (SKILL.md modules).
create table if not exists public.skills (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text not null default '',
  content     text not null default '',
  triggers    text[] not null default '{}',
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists skills_enabled_idx on public.skills (enabled);
alter table public.skills disable row level security;

commit;
