-- Migration 0001 — Lock chat tables to authenticated users (Supabase Auth + RLS)
--
-- This migration is the database half of Task #2. It is intentionally
-- forward-only and idempotent so the operator can apply it from the
-- Supabase SQL editor once Supabase Auth is configured for the project.
--
-- ORDER OF OPERATIONS (important — apply as one transaction):
--   1. Wipe existing chat rows (already done programmatically by the
--      prep PR, kept here for reproducibility).
--   2. Add `user_id` column to `sessions` (NOT NULL, FK -> auth.users).
--   3. Re-enable RLS on the four chat tables.
--   4. Add policies so each user sees only their own rows.
--
-- The Realtime publication membership (`supabase_realtime`) is left
-- alone — Realtime respects RLS automatically once it's on.
--
-- DO NOT APPLY this migration until:
--   (a) the Supabase Auth provider is enabled in the dashboard, AND
--   (b) the application code that authenticates API requests has
--       shipped to main (the second half of Task #2).
-- Applying it earlier will hard-break the running app, since every
-- current `/api/*` call uses the service-role key and would still
-- work, but every browser-side Realtime subscription using the anon
-- key would suddenly return zero rows.

begin;

-- 1. Wipe chat data. The prep PR already did this programmatically,
-- but re-running here keeps the migration self-contained.
truncate table public.messages,
               public.chat_warnings,
               public.session_constitution_state,
               public.sessions
          restart identity cascade;

-- 2. Owner column on sessions. NOT NULL is safe because step 1 just
-- emptied the table.
alter table public.sessions
  add column if not exists user_id uuid not null
  references auth.users(id) on delete cascade;

create index if not exists sessions_user_id_idx
  on public.sessions (user_id);

-- 3. Re-enable RLS on every chat table.
alter table public.sessions                     enable row level security;
alter table public.messages                     enable row level security;
alter table public.chat_warnings                enable row level security;
alter table public.session_constitution_state   enable row level security;

-- 4a. Sessions — owner is the row's user_id.
drop policy if exists sessions_select_own on public.sessions;
create policy sessions_select_own on public.sessions
  for select using (auth.uid() = user_id);

drop policy if exists sessions_insert_own on public.sessions;
create policy sessions_insert_own on public.sessions
  for insert with check (auth.uid() = user_id);

drop policy if exists sessions_update_own on public.sessions;
create policy sessions_update_own on public.sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists sessions_delete_own on public.sessions;
create policy sessions_delete_own on public.sessions
  for delete using (auth.uid() = user_id);

-- 4b. Messages — owner is the parent session's user_id.
drop policy if exists messages_select_own on public.messages;
create policy messages_select_own on public.messages
  for select using (
    exists (
      select 1 from public.sessions s
      where s.id = messages.session_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own on public.messages
  for insert with check (
    exists (
      select 1 from public.sessions s
      where s.id = messages.session_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages
  for update using (
    exists (
      select 1 from public.sessions s
      where s.id = messages.session_id
        and s.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.sessions s
      where s.id = messages.session_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages
  for delete using (
    exists (
      select 1 from public.sessions s
      where s.id = messages.session_id
        and s.user_id = auth.uid()
    )
  );

-- 4c. chat_warnings — same join via session_id.
drop policy if exists chat_warnings_select_own on public.chat_warnings;
create policy chat_warnings_select_own on public.chat_warnings
  for select using (
    exists (
      select 1 from public.sessions s
      where s.id = chat_warnings.session_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists chat_warnings_insert_own on public.chat_warnings;
create policy chat_warnings_insert_own on public.chat_warnings
  for insert with check (
    exists (
      select 1 from public.sessions s
      where s.id = chat_warnings.session_id
        and s.user_id = auth.uid()
    )
  );

-- 4d. session_constitution_state — same join via session_id.
drop policy if exists scs_select_own on public.session_constitution_state;
create policy scs_select_own on public.session_constitution_state
  for select using (
    exists (
      select 1 from public.sessions s
      where s.id = session_constitution_state.session_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists scs_insert_own on public.session_constitution_state;
create policy scs_insert_own on public.session_constitution_state
  for insert with check (
    exists (
      select 1 from public.sessions s
      where s.id = session_constitution_state.session_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists scs_update_own on public.session_constitution_state;
create policy scs_update_own on public.session_constitution_state
  for update using (
    exists (
      select 1 from public.sessions s
      where s.id = session_constitution_state.session_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists scs_delete_own on public.session_constitution_state;
create policy scs_delete_own on public.session_constitution_state
  for delete using (
    exists (
      select 1 from public.sessions s
      where s.id = session_constitution_state.session_id
        and s.user_id = auth.uid()
    )
  );

-- NOTE: pr_actions and push_subscriptions are intentionally NOT covered
-- here. pr_actions is server-only audit; push_subscriptions is also
-- server-only (see comments in supabase.sql). Both keep RLS disabled.

commit;
