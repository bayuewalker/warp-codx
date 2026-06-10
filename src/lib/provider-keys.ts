/**
 * Admin-managed provider API keys (server-only).
 *
 * Stored in `public.provider_keys`. The raw `api_key` is NEVER sent to the
 * browser — admin UI receives masked previews via `maskKey`. The chat layer
 * (src/lib/llm.ts) reads enabled keys ordered by priority to build the
 * auto-switch fallback chain.
 *
 * Read helpers degrade to [] on failure so a missing table / outage falls back
 * to env-based keys rather than breaking chat.
 */
import { getServerSupabase } from "./supabase";
import { SUPPORTED_PROVIDERS, type Provider } from "./provider";

export type ProviderKey = {
  id: string;
  provider: Provider;
  api_key: string;
  label: string;
  enabled: boolean;
  priority: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

/** Browser-safe view — never includes the raw key. */
export type ProviderKeyPublic = {
  id: string;
  provider: Provider;
  label: string;
  enabled: boolean;
  priority: number;
  last_error: string | null;
  keyPreview: string;
  created_at: string;
};

const SELECT =
  "id, provider, api_key, label, enabled, priority, last_error, created_at, updated_at";

export function isProvider(v: unknown): v is Provider {
  return typeof v === "string" && (SUPPORTED_PROVIDERS as readonly string[]).includes(v);
}

/** Mask a secret for display: keep a short prefix/suffix, hide the middle. */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 8) return "••••";
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

export function toPublic(k: ProviderKey): ProviderKeyPublic {
  return {
    id: k.id,
    provider: k.provider,
    label: k.label,
    enabled: k.enabled,
    priority: k.priority,
    last_error: k.last_error,
    keyPreview: maskKey(k.api_key),
    created_at: k.created_at,
  };
}

export async function listProviderKeys(): Promise<ProviderKey[]> {
  try {
    const supabase = getServerSupabase();
    const { data, error } = await supabase
      .from("provider_keys")
      .select(SELECT)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return data as ProviderKey[];
  } catch {
    return [];
  }
}

/** Enabled keys only, in auto-switch order (priority asc, then oldest first). */
export async function listEnabledProviderKeys(): Promise<ProviderKey[]> {
  return (await listProviderKeys()).filter((k) => k.enabled);
}

export async function createProviderKey(input: {
  provider: Provider;
  apiKey: string;
  label?: string;
  priority?: number;
}): Promise<ProviderKey> {
  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("provider_keys")
    .insert({
      provider: input.provider,
      api_key: input.apiKey.trim(),
      label: input.label?.trim() ?? "",
      priority: input.priority ?? 100,
      enabled: true,
    })
    .select(SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data as ProviderKey;
}

export async function updateProviderKey(
  id: string,
  patch: { enabled?: boolean; label?: string; priority?: number; apiKey?: string },
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.label !== undefined) row.label = patch.label.trim();
  if (patch.priority !== undefined) row.priority = patch.priority;
  if (patch.apiKey !== undefined && patch.apiKey.trim()) {
    row.api_key = patch.apiKey.trim();
    row.last_error = null; // a fresh key clears the stale failover error
  }
  const supabase = getServerSupabase();
  const { error } = await supabase.from("provider_keys").update(row).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteProviderKey(id: string): Promise<void> {
  const supabase = getServerSupabase();
  const { error } = await supabase.from("provider_keys").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Record the last failover error for a key (best-effort; never throws). */
export async function markProviderKeyError(id: string, error: string): Promise<void> {
  try {
    const supabase = getServerSupabase();
    await supabase
      .from("provider_keys")
      .update({ last_error: error.slice(0, 300), updated_at: new Date().toISOString() })
      .eq("id", id);
  } catch {
    /* best-effort */
  }
}
