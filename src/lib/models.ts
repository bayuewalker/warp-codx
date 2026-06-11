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
    cmd: "blackboxai/anthropic/claude-sonnet-4.6",
    forge: "blackboxai/anthropic/claude-sonnet-4.6",
    sentinel: "blackboxai/anthropic/claude-sonnet-4.6",
    echo: "blackboxai/openai/gpt-5.4-nano",
  },
};

/**
 * Backward-compatible default map (OpenRouter slugs). Retained so existing
 * imports keep working; prefer `getModel(role)` for provider-aware resolution.
 */
export const MODELS = MODEL_MATRIX.openrouter;

/**
 * Resolve the model slug for a role under a specific provider. Honors the
 * `LLM_MODEL` env override (applies across providers). Used by the auto-switch
 * failover chain, which picks the model to match whichever provider's key it
 * is currently trying.
 */
export function getModelForProvider(provider: Provider, role: AgentRole = "cmd"): string {
  const override = process.env.LLM_MODEL?.trim();
  if (override) return override;
  return MODEL_MATRIX[provider][role];
}

/**
 * Resolve the model slug for a given agent role under the active (env-selected)
 * provider. Honors the `LLM_MODEL` env override.
 */
export function getModel(role: AgentRole = "cmd"): string {
  return getModelForProvider(getProvider(), role);
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

// ─────────────────────────── Model selection ───────────────────────────
//
// User-facing model picker (composer). "Auto" routes per message — a strong
// coding model (Sonnet) for code work, a general model (GPT-4o) for plain chat
// — while explicit picks pin one model. Each logical choice maps to the right
// per-provider slug so it works whichever provider the failover chain uses.

export type SelectableModelId =
  | "auto"
  | "sonnet"
  | "opus"
  | "gpt-5"
  | "gpt-4o"
  | "gpt-4o-mini";

/** Vendor grouping for the composer picker tree ("Auto" sits outside groups). */
export type ModelVendor = "Claude" | "GPT";

export type SelectableModel = {
  id: SelectableModelId;
  label: string;
  /** Compact label for the closed picker / status strip. */
  short: string;
  hint: string;
  /** Vendor group in the picker tree (omitted for "auto"). */
  vendor?: ModelVendor;
  /** Per-provider slug. Missing providers fall back to the role default. */
  slugs: Partial<Record<Provider, string>>;
};

export const SELECTABLE_MODELS: SelectableModel[] = [
  {
    id: "auto",
    label: "Auto",
    short: "Auto",
    hint: "Sonnet for coding, GPT-4o for chat",
    slugs: {},
  },
  {
    id: "sonnet",
    label: "Claude Sonnet 4.6",
    short: "Sonnet 4.6",
    hint: "Best for coding & reasoning",
    vendor: "Claude",
    slugs: {
      openrouter: "anthropic/claude-sonnet-4-6",
      blackbox: "blackboxai/anthropic/claude-sonnet-4.6",
      openai: "gpt-4o", // no Claude on OpenAI — closest capable fallback
    },
  },
  {
    id: "opus",
    label: "Claude Opus 4.6",
    short: "Opus 4.6",
    hint: "Most capable — deep reasoning",
    vendor: "Claude",
    // "If available": where a provider lacks Opus the slug is omitted and the
    // failover resolves the provider's cmd default instead of erroring.
    slugs: {
      openrouter: "anthropic/claude-opus-4-6",
      blackbox: "blackboxai/anthropic/claude-opus-4.6",
      // no Claude on OpenAI — falls back to the provider cmd default
    },
  },
  {
    id: "gpt-5",
    label: "GPT-5",
    short: "GPT-5",
    hint: "OpenAI flagship",
    vendor: "GPT",
    slugs: {
      openrouter: "openai/gpt-5",
      openai: "gpt-5",
      blackbox: "blackboxai/openai/gpt-5.5",
    },
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    short: "GPT-4o",
    hint: "General purpose chat",
    vendor: "GPT",
    slugs: {
      openrouter: "openai/gpt-4o",
      openai: "gpt-4o",
      // Blackbox no longer serves `blackboxai/openai/gpt-4o` (returns 400
      // "Invalid model name"); its closest live GPT chat model is gpt-5.5.
      blackbox: "blackboxai/openai/gpt-5.5",
    },
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    short: "GPT-4o mini",
    hint: "Fast & cheap",
    vendor: "GPT",
    slugs: {
      openrouter: "openai/gpt-4o-mini",
      openai: "gpt-4o-mini",
      blackbox: "blackboxai/openai/gpt-5.4-nano",
    },
  },
];

/** Vendor groups in picker display order. */
export const MODEL_VENDORS: ModelVendor[] = ["Claude", "GPT"];

/**
 * Providers that can serve a given selectable model (those with a mapped slug).
 * "auto" is provider-agnostic, so it returns null (served by any active key).
 */
export function providersForModel(id: SelectableModelId): Provider[] | null {
  if (id === "auto") return null;
  const m = SELECTABLE_MODELS.find((x) => x.id === id);
  if (!m) return [];
  return Object.keys(m.slugs) as Provider[];
}

/**
 * Whether a model is usable given the set of currently-active providers (those
 * with an enabled, reachable key). "auto" needs at least one active provider; a
 * specific model needs at least one active provider that maps it.
 */
export function isModelAvailable(
  id: SelectableModelId,
  active: readonly Provider[],
): boolean {
  if (active.length === 0) return false;
  const providers = providersForModel(id);
  if (providers === null) return true; // auto — any active provider works
  return providers.some((p) => active.includes(p));
}

/**
 * The selectable models usable right now, in registry order. Used by the
 * composer picker so it only ever offers models a configured provider can
 * actually serve. With no active provider the list is empty.
 */
export function availableSelectableModels(
  active: readonly Provider[],
): SelectableModel[] {
  return SELECTABLE_MODELS.filter((m) => isModelAvailable(m.id, active));
}

export function modelShort(id: SelectableModelId): string {
  return SELECTABLE_MODELS.find((m) => m.id === id)?.short ?? id;
}

export function isSelectableModelId(v: unknown): v is SelectableModelId {
  return (
    v === "auto" ||
    v === "sonnet" ||
    v === "opus" ||
    v === "gpt-5" ||
    v === "gpt-4o" ||
    v === "gpt-4o-mini"
  );
}

export function modelLabel(id: SelectableModelId): string {
  return SELECTABLE_MODELS.find((m) => m.id === id)?.label ?? id;
}

/**
 * Resolve a concrete provider slug for a (non-auto) selected model under a
 * given provider, falling back to the provider's `cmd` default if that model
 * isn't mapped for the provider.
 */
export function resolveSelectedModel(
  id: SelectableModelId,
  provider: Provider,
): string {
  const override = process.env.LLM_MODEL?.trim();
  if (override) return override;
  const entry = SELECTABLE_MODELS.find((m) => m.id === id);
  return entry?.slugs[provider] ?? MODEL_MATRIX[provider].cmd;
}

/**
 * Lightweight, transparent coding-vs-chat classifier for "Auto". Looks for a
 * code fence or common engineering keywords. Used only to pick the default
 * model; never hidden from the user (the strip still shows what's active).
 */
export function isCodingMessage(text: string): boolean {
  if (/```/.test(text)) return true;
  return /\b(code|coding|function|class|bug|debug|error|stack ?trace|refactor|implement|compile|api|endpoint|sql|query|regex|component|deploy|docker|build|test|npm|yarn|pnpm|git|typescript|javascript|python|java|rust|golang|react|next\.?js|node|css|html|terminal|command|script)\b/i.test(
    text,
  );
}

/** Auto-route a message to a concrete selectable model id. */
export function autoPickModelId(userMessage: string): SelectableModelId {
  return isCodingMessage(userMessage) ? "sonnet" : "gpt-4o";
}
