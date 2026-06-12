-- Migration 0008 — Enable Realtime publication for agent_runs
--
-- The agent monitor UI subscribes via Supabase Realtime to get live step
-- updates without polling. Adding agent_runs to the supabase_realtime
-- publication makes UPDATE events flow to connected browser clients.
-- RLS (set up in 0007) still filters rows — only the owner can subscribe.

begin;

alter publication supabase_realtime add table public.agent_runs;

commit;
