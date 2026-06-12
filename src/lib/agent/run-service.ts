/**
 * Run service — kicks off a coding-agent run and persists its progress.
 *
 * Bridges the pure {@link runCodingAgent} orchestrator to the `agent_runs`
 * store and enforces a concurrency limit (cost/runaway guard). A run executes
 * in the background: we create the row, stamp the routing decision, return the
 * id immediately, and let the loop stream steps into the row so the monitor UI
 * can poll/subscribe. The server is long-lived (fly.io), so a detached run is
 * the right shape rather than blocking the request for the whole loop.
 */
import { getProvider, type Provider } from "../provider";
import { routeAgentModel } from "./model-router";
import { runCodingAgent, type CodingAgentDeps } from "./orchestrator";
import {
  createAgentRun,
  listAgentRuns,
  updateAgentRun,
} from "./agent-runs";
import type { AgentStep } from "./loop";

/** Max simultaneously-running runs per user. */
export const MAX_CONCURRENT_RUNS = 2;

export type StartRunInput = {
  userId: string;
  task: string;
  repoUrl?: string;
  branch?: string;
  maxSteps?: number;
};

export type StartRunResult =
  | { id: string }
  | { error: string; status: number };

/**
 * Validate + start a run. Returns the new run id on success, or an error with
 * an HTTP status the route maps directly. The actual loop runs detached.
 */
export async function startAgentRun(
  input: StartRunInput,
  deps: CodingAgentDeps = {},
): Promise<StartRunResult> {
  const task = input.task?.trim();
  if (!task) return { error: "task is required", status: 400 };

  // Concurrency limit — count the user's in-flight runs.
  const running = (await listAgentRuns(input.userId)).filter(
    (r) => r.status === "running",
  ).length;
  if (running >= MAX_CONCURRENT_RUNS) {
    return {
      error: `You already have ${running} run(s) in progress (max ${MAX_CONCURRENT_RUNS}).`,
      status: 429,
    };
  }

  const id = await createAgentRun({
    userId: input.userId,
    task,
    repoUrl: input.repoUrl,
    branch: input.branch,
  });
  if (!id) return { error: "Failed to create run record", status: 500 };

  // Stamp the routing decision up front so the UI explains the model choice
  // before the loop produces any steps. The orchestrator re-routes internally;
  // this is the same pure classification, so it always agrees.
  const provider = (deps.resolveProvider ?? safeProvider)();
  const route = routeAgentModel(task, provider);
  await updateAgentRun(id, {
    difficulty: route.difficulty,
    tier: route.tier,
    model: route.model,
    provider,
  });

  void executeRun(id, { ...input, task }, deps);
  return { id };
}

/** Active provider, falling back to the default if LLM_PROVIDER is unset/invalid. */
function safeProvider(): Provider {
  try {
    return getProvider();
  } catch {
    return "openrouter";
  }
}

/**
 * Run the loop to completion, persisting the growing transcript on each step
 * and the terminal status at the end. Never throws — a failure is recorded on
 * the run row so the UI surfaces it.
 */
async function executeRun(
  id: string,
  input: StartRunInput,
  deps: CodingAgentDeps,
): Promise<void> {
  const steps: AgentStep[] = [];
  try {
    const result = await runCodingAgent(
      {
        task: input.task,
        repoUrl: input.repoUrl,
        branch: input.branch,
        maxSteps: input.maxSteps,
      },
      {
        ...deps,
        onStep: (step) => {
          steps.push(step);
          // Best-effort live update; the final write below is authoritative.
          void updateAgentRun(id, { steps: [...steps] });
          deps.onStep?.(step);
        },
      },
    );

    await updateAgentRun(id, {
      status: result.status,
      difficulty: result.difficulty,
      tier: result.tier,
      model: result.model,
      provider: result.provider,
      sandboxId: result.sandboxId,
      summary: result.summary,
      steps: result.steps,
      finished: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateAgentRun(id, {
      status: "error",
      summary: `Run failed: ${msg}`,
      steps: [...steps],
      finished: true,
    });
  }
}
