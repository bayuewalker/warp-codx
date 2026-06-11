-- Migration 0007 — Coding-agent run records
--
-- Adds public.agent_runs: one row per autonomous coding-agent run. The server
-- (service-role) creates the row when a run starts and updates it as the loop
-- streams steps + finishes. The browser reads its own runs (history + a live
-- monitor via Realtime), so RLS is enabled and scoped to the owner, matching
-- the per-user isolation pattern established for sessions/messages in 0005.
--
-- `steps` is the full ReAct transcript (thought + tool executions) as jsonb so
-- the monitor UI can render it without a child table. Non-destructive,
-- idempotent, forward-only.

begin;

create extension if not exists "pgcrypto";

create table if not exists public.agent_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  task        text not null,
  repo_url    text,
  branch      text,
  -- Lifecycle: running → completed | max_steps | error.
  status      text not null default 'running'
                check (status in ('running', 'completed', 'max_steps', 'error')),
  -- Routing decision (why this model was chosen), null until classified.
  difficulty  text check (difficulty in ('easy', 'medium', 'hard')),
  tier        text check (tier in ('haiku', 'sonnet', 'opus')),
  model       text,
  provider    text,
  -- Backend sandbox id (Daytona), for logs/debugging.
  sandbox_id  text,
  -- Final summary (finish summary, trailing prose, or error message).
  summary     text,
  -- Full step transcript: [{ index, thought, executions: [...] }].
  steps       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists agent_runs_user_idx
  on public.agent_runs (user_id, created_at desc);

alter table public.agent_runs enable row level security;

-- Owner-scoped access. Server writes use the service-role key (bypasses RLS);
-- these policies cover the browser's anon-key reads + Realtime subscription.
drop policy if exists agent_runs_select_own on public.agent_runs;
create policy agent_runs_select_own on public.agent_runs
  for select using (auth.uid() = user_id);

drop policy if exists agent_runs_insert_own on public.agent_runs;
create policy agent_runs_insert_own on public.agent_runs
  for insert with check (auth.uid() = user_id);

drop policy if exists agent_runs_update_own on public.agent_runs;
create policy agent_runs_update_own on public.agent_runs
  for update using (auth.uid() = user_id);

commit;
