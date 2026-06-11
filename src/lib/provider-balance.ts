/**
 * Best-effort provider credit / balance lookup (server-only).
 *
 * Providers don't share a balance API, so this is a per-provider strategy with
 * graceful degradation: when a provider doesn't expose balance over its API (or
 * the call fails) we return `supported: false` with a short note rather than
 * throwing — the admin UI shows "n/a" instead of breaking.
 *
 *   - openrouter — GET /credits → { data: { total_credits, total_usage } }
 *   - blackbox   — best-effort probe of a few likely endpoints (undocumented)
 *   - openai     — no public per-key balance endpoint → unsupported
 *
 * The raw key never leaves the server; this module is called from an
 * admin-gated route with the stored key.
 */
import type { Provider } from "./provider";

export type BalanceResult = {
  /** True when the provider exposed a usable balance figure. */
  supported: boolean;
  /** Total credits granted/purchased (provider units, usually USD). */
  credits: number | null;
  /** Total credits consumed. */
  usage: number | null;
  /** Remaining balance (credits − usage when both known). */
  remaining: number | null;
  /** Display unit, e.g. "USD" or "credits". */
  currency: string;
  /** Short human note (why unsupported, or extra context). */
  note?: string;
  /** Error string when the lookup failed outright. */
  error?: string;
};

const TIMEOUT_MS = 8000;

function unsupported(note: string): BalanceResult {
  return {
    supported: false,
    credits: null,
    usage: null,
    remaining: null,
    currency: "USD",
    note,
  };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** GET JSON with a bearer token and a hard timeout. Returns null on any failure. */
async function getJson(
  url: string,
  apiKey: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    return json && typeof json === "object"
      ? (json as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** OpenRouter: GET {base}/credits → { data: { total_credits, total_usage } }. */
async function openrouterBalance(
  apiKey: string,
  baseURL: string,
): Promise<BalanceResult> {
  const json = await getJson(`${baseURL.replace(/\/$/, "")}/credits`, apiKey);
  const data = (json?.data ?? null) as Record<string, unknown> | null;
  if (!data) {
    return {
      ...unsupported("OpenRouter balance unavailable (check the key)."),
      error: "lookup failed",
    };
  }
  const credits = num(data.total_credits);
  const usage = num(data.total_usage);
  const remaining =
    credits !== null && usage !== null ? credits - usage : null;
  return {
    supported: credits !== null || usage !== null,
    credits,
    usage,
    remaining,
    currency: "USD",
  };
}

/**
 * Blackbox: undocumented balance API. Probe a few plausible OpenAI-style
 * endpoints and parse common shapes; fall back to unsupported when none answer.
 */
async function blackboxBalance(
  apiKey: string,
  baseURL: string,
): Promise<BalanceResult> {
  const base = baseURL.replace(/\/$/, "");
  const candidates = [
    `${base}/v1/credits`,
    `${base}/credits`,
    `${base}/v1/dashboard/billing/credit_grants`,
    `${base}/user/info`,
  ];
  for (const url of candidates) {
    const json = await getJson(url, apiKey);
    if (!json) continue;
    // Accept a handful of shapes seen across OpenAI-compatible billing APIs.
    const data = (json.data ?? json) as Record<string, unknown>;
    const credits =
      num(data.total_credits) ??
      num(data.total_granted) ??
      num(data.credits) ??
      num(data.balance);
    const usage = num(data.total_usage) ?? num(data.total_used) ?? num(data.usage);
    const remaining =
      num(data.total_available) ??
      num(data.remaining) ??
      (credits !== null && usage !== null ? credits - usage : credits);
    if (credits !== null || usage !== null || remaining !== null) {
      return {
        supported: true,
        credits,
        usage,
        remaining,
        currency: typeof data.currency === "string" ? data.currency : "USD",
      };
    }
  }
  return unsupported("Blackbox API doesn't expose balance — see dashboard.");
}

/**
 * Resolve a provider key's balance. Always resolves (never throws) so the admin
 * UI can render a result or a graceful "n/a".
 */
export async function fetchProviderBalance(
  provider: Provider,
  apiKey: string,
  baseURL: string,
): Promise<BalanceResult> {
  try {
    switch (provider) {
      case "openrouter":
        return await openrouterBalance(apiKey, baseURL);
      case "blackbox":
        return await blackboxBalance(apiKey, baseURL);
      case "openai":
        return unsupported(
          "OpenAI has no per-key balance endpoint — see platform billing.",
        );
      default:
        return unsupported("Balance not supported for this provider.");
    }
  } catch (err) {
    return {
      ...unsupported("Balance lookup failed."),
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}
