/**
 * Centralized model registry for W.A.R.P Engine agents.
 *
 * Chat completions go through whichever provider `LLM_PROVIDER` selects
 * (OpenRouter / OpenAI / Blackbox — see `src/lib/provider.ts`). Each provider
 * names its models differently, so the registry keeps a per-provider default
 * matrix and resolves the right slug for the active provider at call time.
 *
 * Precedence for the model actually sent to the API:
 *   1. `LLM_MODEL` env var (explicit override, wins for every role)
 *   2. The per-provider default for the requested role (below)
 */
import { getProvider, type Provider } from "./provider";

export type AgentRole = "cmd" | "forge" | "sentinel" | "echo";

/**
 * Per-provider default model matrix. Override any of these at runtime with the
 * `LLM_MODEL` env var (applies to every role).
 *
 * Blackbox model IDs use the `blackboxai/<vendor>/<model>` form; adjust via
 * `LLM_MODEL` to match what your account exposes.
 */
const MODEL_MATRIX: Record<Provider, Record<AgentRole, string>> = {
  openrouter: {
    cmd: "anthropic/claude-sonnet-4-6",
    forge: "anthropic/claude-sonnet-4-6",
    sentinel: "anthropic/claude-sonnet-4-6",
    echo: "openai/gpt-4o-mini",
  },
  openai: {
    cmd: "gpt-4o",
    forge: "gpt-4o",
    sentinel: "gpt-4o",
    echo: "gpt-4o-mini",
  },
  blackbox: {
    cmd: "blackboxai/anthropic/claude-sonnet-4",
    forge: "blackboxai/anthropic/claude-sonnet-4",
    sentinel: "blackboxai/anthropic/claude-sonnet-4",
    echo: "blackboxai/openai/gpt-4o-mini",
  },
};

/**
 * Backward-compatible default map (OpenRouter slugs). Retained so existing
 * imports keep working; prefer `getModel(role)` for provider-aware resolution.
 */
export const MODELS = MODEL_MATRIX.openrouter;

/**
 * Resolve the model slug for a given agent role under the active provider.
 * Honors the `LLM_MODEL` env override.
 */
export function getModel(role: AgentRole = "cmd"): string {
  const override = process.env.LLM_MODEL?.trim();
  if (override) return override;
  const provider = getProvider();
  return MODEL_MATRIX[provider][role];
}

/**
 * Format a model slug for display in the input chip. Strips the provider
 * prefix and the redundant "claude-" tag so the chip stays compact on mobile
 * (e.g. "anthropic/claude-sonnet-4-6" → "sonnet-4.6";
 * "blackboxai/anthropic/claude-sonnet-4" → "sonnet-4").
 */
export function formatModelSlug(slug: string): string {
  const tail = slug.includes("/") ? slug.split("/").pop()! : slug;
  return tail.replace(/^claude-/, "");
}
