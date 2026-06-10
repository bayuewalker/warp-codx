/**
 * LLM provider resolution layer.
 *
 * The app talks to a single OpenAI-compatible chat-completions endpoint, but
 * the *provider* behind that endpoint is selected at runtime via the
 * `LLM_PROVIDER` env var. All three supported providers expose the same
 * OpenAI-compatible surface (streaming, message format, tool calling), so only
 * the base URL, API key, and a couple of attribution headers differ:
 *
 *   - openrouter — https://openrouter.ai (default; key: OPENROUTER_API_KEY)
 *   - openai     — https://api.openai.com/v1 (key: OPENAI_API_KEY)
 *   - blackbox   — https://api.blackbox.ai (key: BLACKBOX_API_KEY)
 *
 * The active model is resolved separately in `models.ts`, which keeps a
 * per-provider default matrix and honours the `LLM_MODEL` override.
 */

export type Provider = "openrouter" | "openai" | "blackbox";

export const SUPPORTED_PROVIDERS: readonly Provider[] = [
  "openrouter",
  "openai",
  "blackbox",
] as const;

export const DEFAULT_PROVIDER: Provider = "openrouter";

type ProviderSpec = {
  /** Base URL the OpenAI SDK points at. The SDK appends `/chat/completions`. */
  baseURL: string;
  /** Env var that holds this provider's API key. */
  keyEnv: string;
  /** Human-friendly label + where to get a key (used in error messages). */
  keyHint: string;
};

const PROVIDER_SPECS: Record<Provider, ProviderSpec> = {
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    keyHint:
      "Get a key at https://openrouter.ai/keys (format: sk-or-v1-...).",
  },
  openai: {
    baseURL: "https://api.openai.com/v1",
    keyEnv: "OPENAI_API_KEY",
    keyHint: "Get a key at https://platform.openai.com/api-keys (format: sk-...).",
  },
  blackbox: {
    // Blackbox exposes an OpenAI-compatible API; the SDK appends
    // `/chat/completions` to this base. Enterprise users override the host
    // via BLACKBOX_BASE_URL.
    baseURL: "https://api.blackbox.ai",
    keyEnv: "BLACKBOX_API_KEY",
    keyHint: "Get a key from your Blackbox AI dashboard (https://www.blackbox.ai/api).",
  },
};

/** Env var name that holds a given provider's API key. */
export function providerKeyEnv(provider: Provider): string {
  return PROVIDER_SPECS[provider].keyEnv;
}

/**
 * Base URL the OpenAI SDK should target for a provider, honoring an optional
 * `<PROVIDER>_BASE_URL` override (e.g. Blackbox enterprise host, OpenAI proxy).
 */
export function providerBaseURL(provider: Provider): string {
  const override = process.env[`${provider.toUpperCase()}_BASE_URL`]?.trim();
  return override || PROVIDER_SPECS[provider].baseURL;
}

/** Provider-specific default headers (only OpenRouter uses attribution headers). */
export function providerHeaders(provider: Provider): Record<string, string> {
  if (provider !== "openrouter") return {};
  return {
    "HTTP-Referer":
      process.env.NEXT_PUBLIC_SITE_URL ?? "https://warp-codx.fly.dev",
    "X-Title": "WARP CodX",
  };
}

/**
 * Resolve the active provider from `LLM_PROVIDER`. Case-insensitive; falls
 * back to the default when unset and throws on an unknown value so a typo
 * surfaces loudly instead of silently defaulting.
 */
export function getProvider(): Provider {
  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (!raw) return DEFAULT_PROVIDER;
  if ((SUPPORTED_PROVIDERS as readonly string[]).includes(raw)) {
    return raw as Provider;
  }
  throw new Error(
    `Unknown LLM_PROVIDER "${raw}". Supported values: ${SUPPORTED_PROVIDERS.join(
      ", ",
    )}. See .env.example.`,
  );
}

export type ResolvedProvider = {
  provider: Provider;
  baseURL: string;
  apiKey: string;
  /** Attribution headers (only OpenRouter uses them; empty for others). */
  defaultHeaders: Record<string, string>;
};

/**
 * Resolve the full client config for the active provider: base URL, API key,
 * and any provider-specific headers. Throws a clear, actionable error when the
 * required API key is missing.
 */
export function resolveProvider(): ResolvedProvider {
  const provider = getProvider();
  const spec = PROVIDER_SPECS[provider];

  const apiKey = process.env[spec.keyEnv]?.trim();
  if (!apiKey) {
    throw new Error(
      `Missing required environment variable: ${spec.keyEnv} ` +
        `(needed for LLM_PROVIDER="${provider}"). ${spec.keyHint} See .env.example.`,
    );
  }

  // Allow overriding the base URL per provider (e.g. Blackbox enterprise host
  // or an OpenAI-compatible proxy) without touching code.
  const baseOverrideEnv = `${provider.toUpperCase()}_BASE_URL`;
  const baseURL = process.env[baseOverrideEnv]?.trim() || spec.baseURL;

  const defaultHeaders: Record<string, string> = {};
  if (provider === "openrouter") {
    // OpenRouter attribution headers — used for usage analytics + rankings.
    defaultHeaders["HTTP-Referer"] =
      process.env.NEXT_PUBLIC_SITE_URL ?? "https://warp-codx.fly.dev";
    defaultHeaders["X-Title"] = "WARP CodX";
  }

  return { provider, baseURL, apiKey, defaultHeaders };
}
