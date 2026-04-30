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
  cmd: "anthropic/claude-sonnet-4.6", // WARP🔹CMD director
  forge: "anthropic/claude-sonnet-4.6", // Builder agent (Phase 4)
  sentinel: "anthropic/claude-sonnet-4.6", // Reviewer agent (Phase 4)
  echo: "openai/gpt-4o-mini", // Reporter agent (Phase 4, fast & cheap)
} as const;

export type AgentRole = keyof typeof MODELS;

/**
 * Format an OpenRouter model slug for display in the input chip.
 * Strips the provider prefix and the redundant "claude-" tag so the chip
 * stays compact on mobile (e.g. "anthropic/claude-sonnet-4.6" → "sonnet-4.6").
 */
export function formatModelSlug(slug: string): string {
  const tail = slug.includes("/") ? slug.split("/").pop()! : slug;
  return tail.replace(/^claude-/, "");
}
