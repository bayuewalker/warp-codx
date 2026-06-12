/**
 * Coding-agent orchestrator — the one call that runs an autonomous task.
 *
 * Ties the pieces together: classify difficulty + pick a model
 * ({@link routeAgentModel}), spin up an isolated workspace
 * ({@link daytonaSandboxProvider}), drive the ReAct loop ({@link runAgentLoop})
 * with the real tool-calling client ({@link createAgentLlmClient}), and
 * guarantee the sandbox is torn down afterward. Every collaborator is injectable
 * so this is unit-testable without Daytona or a live LLM; the defaults wire the
 * production backends.
 */
import { getProvider, type Provider } from "../provider";
import { createAgentLlmClient } from "./llm-client";
import { runAgentLoop, type AgentStep, type LlmClient, type RunStatus } from "./loop";
import { routeAgentModel, type AgentDifficulty, type AgentTier } from "./model-router";
import { daytonaSandboxProvider } from "./sandbox-daytona";
import type { SandboxProvider } from "./sandbox";

/** Default system prompt establishing the agent's role + workspace contract. */
export const AGENT_SYSTEM_PROMPT = `You are WARP CodX, an autonomous coding agent working in an isolated, ephemeral sandbox that already has the target repository cloned at the workspace root.

Workflow:
- Use the provided tools to inspect and modify the repo. All paths are RELATIVE to the repo root (use "." for the root).
- Before editing, read the relevant files and explore the structure so your change fits the existing code.
- Make the smallest change that fully satisfies the task. Match the surrounding style.
- Verify your work by running the project's build/test/lint commands via run_command when they exist.
- When the task is a code change, commit it on a new branch and push it (the sandbox is pre-authenticated for git over HTTPS), then call finish with a short summary that names the branch.
- If a tool fails, read the error and adapt — do not repeat the same failing call.

Call finish exactly once, when the task is complete or you have done all you safely can. Keep prose terse and action-oriented.`;

export type CodingAgentRequest = {
  /** Natural-language task for the agent. */
  task: string;
  /** HTTPS repo URL to clone into the workspace. */
  repoUrl?: string;
  /** Branch to check out after clone (the base for the agent's work). */
  branch?: string;
  /** Hard cap on model turns (cost guard). Defaults to the loop's own default. */
  maxSteps?: number;
};

export type CodingAgentDeps = {
  /** Sandbox backend (default: Daytona). */
  sandboxProvider?: SandboxProvider;
  /** LLM client factory (default: the real provider-chain client). */
  createLlm?: (resolveModel: (provider: Provider) => string) => LlmClient;
  /** Resolve the active provider for model routing (default: env-selected). */
  resolveProvider?: () => Provider;
  /**
   * Git token injected into the sandbox for clone + push. Defaults to the
   * server-side PAT (reuses the constitution PAT, then generic GitHub envs).
   */
  gitToken?: string;
  /** Override the system prompt. */
  system?: string;
  /** Streamed per-step progress (e.g. to persist + push to the UI). */
  onStep?: (step: AgentStep) => void;
};

export type CodingAgentResult = {
  status: RunStatus;
  summary: string;
  steps: AgentStep[];
  /** Routing decision, surfaced so the run record can explain the model choice. */
  difficulty: AgentDifficulty;
  tier: AgentTier;
  model: string;
  /** Provider used for routing (the chain may differ per call on failover). */
  provider: Provider;
  /** Backend sandbox id (null if creation failed before an id was assigned). */
  sandboxId: string | null;
};

/** Default git token: reuse the constitution PAT, then generic GitHub envs. */
function defaultGitToken(): string | undefined {
  return (
    process.env.GITHUB_PAT_CONSTITUTION?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.GITHUB_PAT?.trim() ||
    undefined
  );
}

/**
 * Run a coding task to completion in a fresh sandbox. Never throws for an
 * in-run failure (the loop captures LLM errors as `status: "error"`); only
 * sandbox *creation* failures propagate, since there's nothing to report on.
 * The sandbox is always destroyed before returning.
 */
export async function runCodingAgent(
  req: CodingAgentRequest,
  deps: CodingAgentDeps = {},
): Promise<CodingAgentResult> {
  const provider = (deps.resolveProvider ?? getProvider)();
  const route = routeAgentModel(req.task, provider);

  // Re-route per candidate provider so the slug stays correct if the chain
  // fails over; difficulty/tier are provider-independent, so only the slug
  // changes.
  const resolveModel = (p: Provider) => routeAgentModel(req.task, p).model;

  const sandboxProvider = deps.sandboxProvider ?? daytonaSandboxProvider;
  const sandbox = await sandboxProvider.create({
    repoUrl: req.repoUrl,
    branch: req.branch,
    gitToken: deps.gitToken ?? defaultGitToken(),
  });

  try {
    const llm = buildLlm(deps, resolveModel);

    const run = await runAgentLoop({
      task: req.task,
      system: deps.system ?? AGENT_SYSTEM_PROMPT,
      llm,
      sandbox,
      maxSteps: req.maxSteps,
      onStep: deps.onStep,
    });

    return {
      ...run,
      difficulty: route.difficulty,
      tier: route.tier,
      model: route.model,
      provider,
      sandboxId: sandbox.id,
    };
  } finally {
    await sandbox.destroy();
  }
}

/** Build the LLM client, honoring an injected factory for tests. */
function buildLlm(
  deps: CodingAgentDeps,
  resolveModel: (provider: Provider) => string,
): LlmClient {
  if (deps.createLlm) return deps.createLlm(resolveModel);
  return createAgentLlmClient({ resolveModel });
}
