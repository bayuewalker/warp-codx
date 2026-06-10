-- Migration 0005 — Per-user data isolation (re-enable RLS, scope sessions to owner)
--
-- Background: migration 0001 introduced per-user isolation (sessions.user_id +
-- RLS), but 0004 rolled it back (dropped policies, disabled RLS) while the app
-- was single-tenant on the service-role key. This migration reintroduces the
-- isolation now that every /api/* route authenticates the caller and stamps
-- sessions.user_id, and the browser client signs in (so its anon-key Realtime
-- subscriptions carry the user's JWT and pass RLS).
--
-- Net effect:
--   * each user only ever sees their own sessions + messages (server filters by
--     user_id AND the database enforces it via RLS for the anon/Realtime path);
--   * the Supabase `rls_disabled_in_public` ERROR advisors on public.sessions
--     and public.messages are cleared.
--
-- Operator pre-approved a fresh start, so existing chat rows are wiped (there
-- are none in production today). Idempotent + forward-only.

begin;

-- 1. Fresh start — wipe chat data. CASCADE clears messages + chat_warnings
--    (and any other session-scoped child tables) via their FKs.
truncate table public.sessions restart identity cascade;

-- 2. Owner column on sessions. The column already exists (added by 0001) but is
--    nullable and unconstrained after the 0004 rollback. Add the FK if missing,
--    then lock it NOT NULL — safe because step 1 emptied the table.
do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'sessions'
      and constraint_type = 'FOREIGN KEY'
      and constraint_name = 'sessions_user_id_fkey'
  ) then
    alter table public.sessions
      add constraint sessions_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end$$;

alter table public.sessions alter column user_id set not null;

create index if not exists sessions_user_id_idx on public.sessions (user_id);

-- 3. Re-enable RLS on the chat tables that lost it in 0004.
alter table public.sessions enable row level security;
alter table public.messages enable row level security;

-- 4a. sessions — owner is the row's user_id.
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

-- 4b. messages — owner is the parent session's user_id.
drop policy if exists messages_select_own on public.messages;
create policy messages_select_own on public.messages
  for select using (
    exists (
      select 1 from public.sessions s
      where s.id = messages.session_id and s.user_id = auth.uid()
    )
  );

drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own on public.messages
  for insert with check (
    exists (
      select 1 from public.sessions s
      where s.id = messages.session_id and s.user_id = auth.uid()
    )
  );

drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages
  for update using (
    exists (
      select 1 from public.sessions s
      where s.id = messages.session_id and s.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.sessions s
      where s.id = messages.session_id and s.user_id = auth.uid()
    )
  );

drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages
  for delete using (
    exists (
      select 1 from public.sessions s
      where s.id = messages.session_id and s.user_id = auth.uid()
    )
  );

-- 4c. chat_warnings already carries owner policies (created in 0001 and never
--     dropped). Recreate them idempotently so a fresh project converges to the
--     same state regardless of which migrations ran.
drop policy if exists chat_warnings_select_own on public.chat_warnings;
create policy chat_warnings_select_own on public.chat_warnings
  for select using (
    exists (
      select 1 from public.sessions s
      where s.id = chat_warnings.session_id and s.user_id = auth.uid()
    )
  );

drop policy if exists chat_warnings_insert_own on public.chat_warnings;
create policy chat_warnings_insert_own on public.chat_warnings
  for insert with check (
    exists (
      select 1 from public.sessions s
      where s.id = chat_warnings.session_id and s.user_id = auth.uid()
    )
  );

commit;
