/**
 * Auto-switch fallback chain.
 *
 * Produces an ordered list of (provider, key) candidates the chat layer tries
 * in turn — if one provider's key is out of credit / rate-limited / invalid,
 * the next candidate is used automatically.
 *
 * Sources, in order:
 *   1. Admin-managed DB keys (public.provider_keys), enabled, by priority.
 *   2. Env keys (OPENROUTER/OPENAI/BLACKBOX_API_KEY) as bootstrap/fallback,
 *      with the LLM_PROVIDER-selected provider first.
 *
 * Duplicates (same provider + same key) are collapsed. If an admin has added a
 * key for every provider, all are in the chain; if only one key exists
 * anywhere (DB or env), the chain has exactly that one.
 */
import {
  SUPPORTED_PROVIDERS,
  getProvider,
  providerBaseURL,
  providerHeaders,
  readProviderEnvKey,
  type Provider,
} from "./provider";
import { listEnabledProviderKeys } from "./provider-keys";

export type ProviderCandidate = {
  source: "db" | "env";
  /** provider_keys.id when source==="db"; null for env keys. */
  keyId: string | null;
  provider: Provider;
  baseURL: string;
  apiKey: string;
  defaultHeaders: Record<string, string>;
};

export async function resolveProviderChain(): Promise<ProviderCandidate[]> {
  const out: ProviderCandidate[] = [];
  const seen = new Set<string>(); // `${provider}|${apiKey}` dedupe

  const push = (
    source: "db" | "env",
    keyId: string | null,
    provider: Provider,
    apiKey: string,
  ) => {
    const dedupe = `${provider}|${apiKey}`;
    if (!apiKey || seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push({
      source,
      keyId,
      provider,
      apiKey,
      baseURL: providerBaseURL(provider),
      defaultHeaders: providerHeaders(provider),
    });
  };

  // 1. Admin-managed DB keys (priority order). Falls through silently if the
  //    table is unavailable.
  try {
    for (const k of await listEnabledProviderKeys()) {
      push("db", k.id, k.provider, k.api_key.trim());
    }
  } catch {
    /* DB unavailable — env fallback below */
  }

  // 2. Env keys. Lead with the LLM_PROVIDER-selected provider so a single-key
  //    env deployment behaves exactly as before.
  let envOrder: Provider[];
  try {
    const active = getProvider();
    envOrder = [active, ...SUPPORTED_PROVIDERS.filter((p) => p !== active)];
  } catch {
    envOrder = [...SUPPORTED_PROVIDERS];
  }
  for (const provider of envOrder) {
    const envKey = readProviderEnvKey(provider);
    if (envKey) push("env", null, provider, envKey);
  }

  return out;
}
