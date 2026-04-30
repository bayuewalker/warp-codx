-- WARP CodX — Phase 1 schema
-- Paste into Supabase SQL Editor and run.

create extension if not exists "pgcrypto";

create table if not exists public.sessions (
  id          uuid primary key default gen_random_uuid(),
  label       text not null default 'New directive',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists sessions_created_at_idx
  on public.sessions (created_at desc);

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant', 'system')),
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists messages_session_created_idx
  on public.messages (session_id, created_at);

-- Phase 1: no auth → disable RLS so anon and service keys both work.
alter table public.sessions  disable row level security;
alter table public.messages  disable row level security;

-- Enable Realtime broadcasts on both tables.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.sessions;
