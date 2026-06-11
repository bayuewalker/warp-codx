/**
 * Coding-agent model router.
 *
 * The interactive chat models are chosen by the user (see `src/lib/models.ts`).
 * The *autonomous coding agent* is different: it runs a multi-step tool loop on
 * its own, so we pick the reasoning model by task difficulty to balance cost
 * against capability —
 *
 *   easy   → Haiku  (cheap/fast: typo fixes, renames, copy tweaks)
 *   medium → Sonnet (the default workhorse for most coding tasks)
 *   hard   → Opus   (multi-file refactors, architecture, tricky debugging)
 *
 * The per-provider Haiku/Sonnet/Opus slugs vary by account and change over
 * time, so every tier is overridable via env (AGENT_MODEL_HAIKU /
 * AGENT_MODEL_SONNET / AGENT_MODEL_OPUS) without a code change. The built-in
 * defaults are best-effort and may need correcting per provider.
 */
import type { Provider } from "../provider";

export type AgentDifficulty = "easy" | "medium" | "hard";
export type AgentTier = "haiku" | "sonnet" | "opus";

/** Difficulty → reasoning tier. */
const DIFFICULTY_TO_TIER: Record<AgentDifficulty, AgentTier> = {
  easy: "haiku",
  medium: "sonnet",
  hard: "opus",
};

/** Env var carrying a per-tier slug override (wins over the matrix below). */
const TIER_ENV: Record<AgentTier, string> = {
  haiku: "AGENT_MODEL_HAIKU",
  sonnet: "AGENT_MODEL_SONNET",
  opus: "AGENT_MODEL_OPUS",
};

/**
 * Per-provider slug matrix per tier. OpenAI has no Claude models, so its Haiku
 * tier maps to the cheap `gpt-4o-mini` and the higher tiers to `gpt-4o`.
 * Verify/override the Anthropic slugs per account via the AGENT_MODEL_* envs.
 */
const TIER_MATRIX: Record<AgentTier, Record<Provider, string>> = {
  haiku: {
    openrouter: "anthropic/claude-haiku-4.5",
    blackbox: "blackboxai/anthropic/claude-haiku-4.5",
    openai: "gpt-4o-mini",
  },
  sonnet: {
    openrouter: "anthropic/claude-sonnet-4-6",
    blackbox: "blackboxai/anthropic/claude-sonnet-4.6",
    openai: "gpt-4o",
  },
  opus: {
    openrouter: "anthropic/claude-opus-4-6",
    blackbox: "blackboxai/anthropic/claude-opus-4.6",
    openai: "gpt-4o",
  },
};

// ── Difficulty classification ──────────────────────────────────────────────
//
// Transparent keyword + length heuristic — never hidden from the user (the run
// record stores the chosen difficulty/tier). Order matters: a task that looks
// hard wins even if it also contains an "easy" verb.

/** Hard: structural / cross-cutting / tricky work, or a very long brief. */
const HARD_RE =
  /\b(refactor|re-?architect|architecture|redesign|migrat\w+|rewrite|overhaul|end[\s-]?to[\s-]?end|across (?:multiple|several|many) files|concurren\w+|race condition|performance|optimi[sz]e|security|vulnerab\w+|design (?:a|the|an) (?:system|feature|api)|from scratch)\b/i;

/** Easy: small, localized edits. */
const EASY_RE =
  /\b(typo|rename|renaming|bump|version|copy(?:\s?writing)?|wording|comment|format|formatting|lint|whitespace|indent\w*|tweak|adjust|spelling|punctuation|readme|changelog)\b/i;

/** Tasks longer than this many words skew hard regardless of verbs. */
const LONG_TASK_WORDS = 60;
/** Easy verbs only count as easy when the brief is short. */
const SHORT_TASK_WORDS = 14;

export function classifyTaskDifficulty(task: string): AgentDifficulty {
  const text = (task ?? "").trim();
  if (!text) return "medium";

  const words = text.split(/\s+/).length;

  if (HARD_RE.test(text) || words > LONG_TASK_WORDS) return "hard";
  if (EASY_RE.test(text) && words <= SHORT_TASK_WORDS) return "easy";
  return "medium";
}

// ── Resolution ───────────────────────────────────────────────────────────

/** Resolve the concrete model slug for a tier under a provider (env wins). */
export function resolveAgentModel(tier: AgentTier, provider: Provider): string {
  const override = process.env[TIER_ENV[tier]]?.trim();
  if (override) return override;
  return TIER_MATRIX[tier][provider];
}

export type AgentModelChoice = {
  difficulty: AgentDifficulty;
  tier: AgentTier;
  model: string;
};

/**
 * One-shot router: classify the task and resolve the model for `provider`.
 * Returns the difficulty/tier alongside the slug so the run record can show
 * the user exactly why a model was chosen.
 */
export function routeAgentModel(
  task: string,
  provider: Provider,
): AgentModelChoice {
  const difficulty = classifyTaskDifficulty(task);
  const tier = DIFFICULTY_TO_TIER[difficulty];
  return { difficulty, tier, model: resolveAgentModel(tier, provider) };
}
