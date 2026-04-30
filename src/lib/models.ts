/**
 * Centralized model registry for WalkerMind OS agents.
 *
 * All chat completions go through OpenRouter (https://openrouter.ai), so model
 * identifiers MUST include the provider prefix (e.g. "openai/gpt-4o").
 *
 * Phase 1 only uses MODELS.cmd. The other roles are pre-wired so that when
 * Phase 4 adds tool-calling and agent dispatch, the model assignments are
 * already a single edit away.
 */
export const MODELS = {
  cmd: "openai/gpt-4o", // WARP🔹CMD director (Phase 1)
  forge: "anthropic/claude-sonnet-4.5", // Builder agent (Phase 4)
  sentinel: "anthropic/claude-sonnet-4.5", // Reviewer agent (Phase 4)
  echo: "openai/gpt-4o-mini", // Reporter agent (Phase 4, fast & cheap)
} as const;

export type AgentRole = keyof typeof MODELS;
