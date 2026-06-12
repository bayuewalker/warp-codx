/**
 * Coding-agent run records (server-only).
 *
 * Persists each run to `public.agent_runs` so the user gets history + a live
 * monitor. Writes use the service-role client; the browser reads its own rows
 * via RLS (see migration 0007). Mirrors the resilience of `provider-keys.ts`:
 * reads degrade to []/null on failure and writes are best-effort so a DB
 * hiccup never crashes an in-flight agent run.
 */
import { getServerSupabase } from "../supabase";
import type { AgentStep, RunStatus } from "./loop";
import type { AgentDifficulty, AgentTier } from "./model-router";
import type { Provider } from "../provider";

/** DB lifecycle status: the loop's terminal statuses plus in-flight `running`. */
export type RunRecordStatus = "running" | RunStatus;

export type AgentRun = {
  id: string;
  user_id: string;
  task: string;
  repo_url: string | null;
  branch: string | null;
  status: RunRecordStatus;
  difficulty: AgentDifficulty | null;
  tier: AgentTier | null;
  model: string | null;
  provider: Provider | null;
  sandbox_id: string | null;
  summary: string | null;
  steps: AgentStep[];
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

const SELECT =
  "id, user_id, task, repo_url, branch, status, difficulty, tier, model, " +
  "provider, sandbox_id, summary, steps, created_at, updated_at, finished_at";

/** Create a `running` run row at kickoff. Returns the row id, or null on failure. */
export async function createAgentRun(input: {
  userId: string;
  task: string;
  repoUrl?: string;
  branch?: string;
}): Promise<string | null> {
  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("agent_runs")
      .insert({
        user_id: input.userId,
        task: input.task,
        repo_url: input.repoUrl ?? null,
        branch: input.branch ?? null,
        status: "running",
      })
      .select("id")
      .single();
    if (error || !data) return null;
    return (data as { id: string }).id;
  } catch {
    return null;
  }
}

/**
 * Patch a run row. Used to stamp the routing decision once classified, to
 * stream the growing step transcript, and to record the terminal status +
 * summary. Best-effort: a failed update must not abort the run.
 */
export async function updateAgentRun(
  id: string,
  patch: Partial<{
    status: RunRecordStatus;
    difficulty: AgentDifficulty;
    tier: AgentTier;
    model: string;
    provider: Provider;
    sandboxId: string | null;
    summary: string;
    steps: AgentStep[];
    finished: boolean;
  }>,
): Promise<void> {
  try {
    const supabase = getServerSupabase();
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.difficulty !== undefined) row.difficulty = patch.difficulty;
    if (patch.tier !== undefined) row.tier = patch.tier;
    if (patch.model !== undefined) row.model = patch.model;
    if (patch.provider !== undefined) row.provider = patch.provider;
    if (patch.sandboxId !== undefined) row.sandbox_id = patch.sandboxId;
    if (patch.summary !== undefined) row.summary = patch.summary;
    if (patch.steps !== undefined) row.steps = patch.steps;
    if (patch.finished) row.finished_at = new Date().toISOString();
    await supabase.from("agent_runs").update(row).eq("id", id);
  } catch {
    /* best-effort persistence */
  }
}

/** Fetch one run by id (owner check is the caller's responsibility). */
export async function getAgentRun(id: string): Promise<AgentRun | null> {
  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("agent_runs")
      .select(SELECT)
      .eq("id", id)
      .single();
    if (error || !data) return null;
    return data as unknown as AgentRun;
  } catch {
    return null;
  }
}

/** List a user's runs, newest first. Degrades to [] on failure. */
export async function listAgentRuns(
  userId: string,
  limit = 50,
): Promise<AgentRun[]> {
  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("agent_runs")
      .select(SELECT)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as unknown as AgentRun[];
  } catch {
    return [];
  }
}
