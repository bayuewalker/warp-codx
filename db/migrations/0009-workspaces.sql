-- Migration 0009 — Persistent IDE workspaces
--
-- Adds public.workspaces: exactly one row per user, pinning that user to a
-- durable Daytona sandbox (`sandbox_id`) so the Replit-style IDE reconnects to
-- the same filesystem across requests and sessions. The server (service-role)
-- creates/updates the row through the workspace lifecycle; the browser reads
-- its own row to render workspace status + the cached preview URL, so RLS is
-- enabled and owner-scoped, matching the per-user isolation pattern from 0005.
--
-- Non-destructive, idempotent, forward-only.

begin;

create extension if not exists "pgcrypto";

create table if not exists public.workspaces (
  id            uuid primary key default gen_random_uuid(),
  -- One workspace per user — the unique key the service upserts on.
  user_id       uuid not null unique references auth.users(id) on delete cascade,
  -- Backend (Daytona) sandbox id this user is pinned to; null while creating.
  sandbox_id    text,
  repo_url      text,
  branch        text,
  -- Lifecycle the IDE understands.
  status        text not null default 'creating'
                  check (status in ('creating', 'running', 'stopped', 'error')),
  -- Port + public URL of the last-started preview (the webview), cached so a
  -- reload restores it without re-launching the dev server.
  preview_port  integer,
  preview_url   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_active_at timestamptz
);

alter table public.workspaces enable row level security;

-- Owner-scoped access. Server writes use the service-role key (bypasses RLS);
-- these policies cover the browser's anon-key reads.
drop policy if exists workspaces_select_own on public.workspaces;
create policy workspaces_select_own on public.workspaces
  for select using (auth.uid() = user_id);

drop policy if exists workspaces_insert_own on public.workspaces;
create policy workspaces_insert_own on public.workspaces
  for insert with check (auth.uid() = user_id);

drop policy if exists workspaces_update_own on public.workspaces;
create policy workspaces_update_own on public.workspaces
  for update using (auth.uid() = user_id);

commit;
