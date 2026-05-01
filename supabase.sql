-- WARP CodX — Phase 1 schema
-- Paste into Supabase SQL Editor and run.

create extension if not exists "pgcrypto";

create table if not exists public.sessions (
  id          uuid primary key default gen_random_uuid(),
  label       text not null default 'New directive',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Task #38 — composite index on (created_at desc, id desc).
--
-- The sidebar pages sessions newest-first using a tuple keyset cursor
-- (see src/app/api/sessions/route.ts):
--
--   ORDER BY created_at DESC, id DESC
--   WHERE  (created_at < :before)
--          OR (created_at = :before AND id < :beforeId)
--   LIMIT  :n + 1
--
-- A single-column (created_at desc) index forces Postgres to fall back
-- to a sort whenever two sessions share the exact same `created_at`,
-- and it can't push the tie-breaker `id` predicate down into an index
-- range scan. The composite (created_at desc, id desc) index matches
-- the ORDER BY exactly, so each "Show more" tap becomes an index range
-- scan that touches only ~limit rows regardless of how large the table
-- is. Drop the redundant single-column index — the composite one
-- serves any query that only filters/sorts by `created_at` too.
drop index if exists public.sessions_created_at_idx;

create index if not exists sessions_created_at_id_idx
  on public.sessions (created_at desc, id desc);

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

-- Phase 3a follow-up: per-session "last seen" Tier-1 constitution SHAs.
-- Lets the chat route detect when an authoritative file changed between
-- consecutive turns of the same session and inject a "constitution
-- updated mid-session" heads-up into the next system prompt.
create table if not exists public.session_constitution_state (
  session_id  uuid not null references public.sessions(id) on delete cascade,
  path        text not null,
  sha         text not null,
  seen_at     timestamptz not null default now(),
  primary key (session_id, path)
);

create index if not exists session_constitution_state_session_idx
  on public.session_constitution_state (session_id);

alter table public.session_constitution_state disable row level security;

-- Phase 3c — PR action audit table.
-- Already applied via the Supabase dashboard during pre-req setup;
-- re-running this block is a no-op thanks to `if not exists`. Kept
-- here so the schema is reproducible from one file.
--
-- One row written per merge / close / hold outcome by
--   src/app/api/prs/[number]/merge/route.ts
--   src/app/api/prs/[number]/close/route.ts
-- Best-effort: a Supabase write failure logs but never undoes the
-- corresponding GitHub action. `verdict` is null for the reserved
-- `review` action (future phase).
create table if not exists public.pr_actions (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid references public.sessions(id) on delete set null,
  pr_number     int not null,
  action        text not null check (action in ('merge', 'close', 'review', 'hold')),
  verdict       text check (verdict in ('ok', 'blocked', 'user-cancelled')),
  reason        text,
  performed_at  timestamptz not null default now()
);

create index if not exists pr_actions_pr_number_idx
  on public.pr_actions (pr_number, performed_at desc);

create index if not exists pr_actions_session_idx
  on public.pr_actions (session_id, performed_at desc);

alter table public.pr_actions disable row level security;

-- Required by PRListView's Realtime auto-refresh. Falls back to the
-- manual refresh button if this publication isn't registered.
alter publication supabase_realtime add table public.pr_actions;

-- Phase 4 — push notification subscriptions. Each row is one Web
-- Push endpoint registered by a browser via /api/push/subscribe.
-- The fanout in src/lib/push-server.ts reads (endpoint, p256dh, auth)
-- and deletes rows whose endpoint returns 410 Gone or 404 (the
-- browser cleared the subscription or the user uninstalled the PWA).
-- Idempotent on `endpoint` so re-subscribing the same browser is a
-- no-op upsert.
--
-- RLS is intentionally disabled — only the Next.js server (using the
-- service-role key) ever touches this table. Browsers never query it
-- directly, and exposing the anon key would be a privacy leak.
create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_endpoint_idx
  on public.push_subscriptions (endpoint);

alter table public.push_subscriptions disable row level security;
