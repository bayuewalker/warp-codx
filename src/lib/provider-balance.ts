/**
 * Best-effort provider credit / balance + key-validity lookup (server-only).
 *
 * Providers don't share a balance API, so this is a per-provider strategy with
 * graceful degradation: when a provider doesn't expose balance over its API (or
 * the call fails) we return `supported: false` with a short note rather than
 * throwing — the admin UI shows "n/a" instead of breaking.
 *
 * Validity is determined independently of balance by probing an authenticated
 * endpoint and reading the HTTP status: 200 → valid, 401/403 → invalid,
 * anything else → unknown. A provider can be `valid` while its balance is `n/a`
 * (e.g. OpenAI / Blackbox expose no balance endpoint).
 *
 *   - openrouter — GET /credits → { data: { total_credits, total_usage } }
 *   - blackbox   — best-effort probe of a few likely endpoints (undocumented)
 *   - openai     — no public per-key balance endpoint → balance unsupported
 *
 * The raw key never leaves the server; this module is called from an
 * admin-gated route with the stored key.
 */
import type { Provider } from "./provider";

export type KeyValidity = "valid" | "invalid" | "unknown";

export type BalanceResult = {
  /** True when the provider exposed a usable balance figure. */
  supported: boolean;
  /** Whether the key authenticates against the provider. */
  valid: KeyValidity;
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

function base(result: Partial<BalanceResult>): BalanceResult {
  return {
    supported: false,
    valid: "unknown",
    credits: null,
    usage: null,
    remaining: null,
    currency: "USD",
    ...result,
  };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

type Probe = {
  /** HTTP status, or 0 when the request never completed (network/timeout). */
  status: number;
  /** Parsed JSON object when the body was JSON, else null. */
  json: Record<string, unknown> | null;
};

/** Map an HTTP status to a key-validity verdict. */
function validityFromStatus(status: number): KeyValidity {
  if (status === 401 || status === 403) return "invalid";
  if (status >= 200 && status < 300) return "valid";
  return "unknown";
}

/** GET with a bearer token + hard timeout. Never throws; status 0 on failure. */
async function probe(url: string, apiKey: string): Promise<Probe> {
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
    let json: Record<string, unknown> | null = null;
    try {
      const parsed = (await res.json()) as unknown;
      if (parsed && typeof parsed === "object") {
        json = parsed as Record<string, unknown>;
      }
    } catch {
      /* non-JSON body — validity still comes from the status */
    }
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null };
  }
}

/** OpenRouter: GET {base}/credits → { data: { total_credits, total_usage } }. */
async function openrouterBalance(
  apiKey: string,
  baseURL: string,
): Promise<BalanceResult> {
  const { status, json } = await probe(
    `${baseURL.replace(/\/$/, "")}/credits`,
    apiKey,
  );
  const valid = validityFromStatus(status);
  const data = (json?.data ?? null) as Record<string, unknown> | null;
  if (!data) {
    return base({
      valid,
      note:
        valid === "invalid"
          ? "Key rejected by OpenRouter."
          : "OpenRouter balance unavailable.",
      error: "lookup failed",
    });
  }
  const credits = num(data.total_credits);
  const usage = num(data.total_usage);
  const remaining = credits !== null && usage !== null ? credits - usage : null;
  return base({
    supported: credits !== null || usage !== null,
    valid: "valid",
    credits,
    usage,
    remaining,
    currency: "USD",
  });
}

/**
 * OpenAI: there is no official per-key balance endpoint on the v1 API, but
 * the legacy dashboard billing endpoints still answer for many account/key
 * types, so try those before giving up:
 *   1. /dashboard/billing/credit_grants → { total_granted, total_used,
 *      total_available } (prepaid credit accounts)
 *   2. /dashboard/billing/subscription → { hard_limit_usd } plus
 *      /dashboard/billing/usage?start_date&end_date → { total_usage } in
 *      CENTS (monthly-billed accounts; remaining = limit − month-to-date)
 * Keys without billing scope 401/404 on these — fall back to the /models
 * validity probe with a graceful n/a, exactly as before.
 */
async function openaiBalance(
  apiKey: string,
  baseURL: string,
): Promise<BalanceResult> {
  // Billing endpoints live at the API root, not under /v1.
  const root = baseURL.replace(/\/$/, "").replace(/\/v1$/, "");

  // 1. Prepaid credit grants.
  const grants = await probe(`${root}/dashboard/billing/credit_grants`, apiKey);
  if (grants.status === 401 || grants.status === 403) {
    // Key is rejected outright — no point probing further.
    return base({
      valid: "invalid",
      note: "Key rejected by OpenAI.",
    });
  }
  if (grants.json) {
    const credits = num(grants.json.total_granted);
    const usage = num(grants.json.total_used);
    const remaining =
      num(grants.json.total_available) ??
      (credits !== null && usage !== null ? credits - usage : null);
    if (remaining !== null || credits !== null) {
      return base({
        supported: true,
        valid: "valid",
        credits,
        usage,
        remaining,
        currency: "USD",
      });
    }
  }

  // 2. Monthly subscription limit minus month-to-date usage.
  const sub = await probe(`${root}/dashboard/billing/subscription`, apiKey);
  const hardLimit = sub.json ? num(sub.json.hard_limit_usd) : null;
  if (hardLimit !== null) {
    const now = new Date();
    const start = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const end = tomorrow.toISOString().slice(0, 10);
    const usageRes = await probe(
      `${root}/dashboard/billing/usage?start_date=${start}&end_date=${end}`,
      apiKey,
    );
    // total_usage is reported in cents.
    const usedCents = usageRes.json ? num(usageRes.json.total_usage) : null;
    const used = usedCents !== null ? usedCents / 100 : null;
    return base({
      supported: true,
      valid: "valid",
      credits: hardLimit,
      usage: used,
      remaining: used !== null ? hardLimit - used : hardLimit,
      currency: "USD",
      note: "Monthly limit − month-to-date usage.",
    });
  }

  // 3. Fallback — validity only, balance n/a.
  const { status } = await probe(`${root}/v1/models`, apiKey);
  return base({
    valid: validityFromStatus(status),
    note: "OpenAI billing endpoints not available for this key — see platform billing.",
  });
}

/**
 * Blackbox: undocumented balance API. Probe a few plausible OpenAI-style
 * endpoints for a balance; separately hit /models to judge key validity.
 */
async function blackboxBalance(
  apiKey: string,
  baseURL: string,
): Promise<BalanceResult> {
  const root = baseURL.replace(/\/$/, "");

  // Validity: /models is the most likely authenticated, cheap endpoint.
  let valid: KeyValidity = "unknown";
  for (const url of [`${root}/v1/models`, `${root}/models`]) {
    const { status } = await probe(url, apiKey);
    const v = validityFromStatus(status);
    if (v !== "unknown") {
      valid = v;
      break;
    }
  }

  // Balance: best-effort across a handful of shapes.
  const candidates = [
    `${root}/v1/credits`,
    `${root}/credits`,
    `${root}/v1/dashboard/billing/credit_grants`,
    `${root}/user/info`,
  ];
  for (const url of candidates) {
    const { status, json } = await probe(url, apiKey);
    if (valid === "unknown") valid = validityFromStatus(status);
    if (!json) continue;
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
      return base({
        supported: true,
        valid: "valid",
        credits,
        usage,
        remaining,
        currency: typeof data.currency === "string" ? data.currency : "USD",
      });
    }
  }
  return base({
    valid,
    note: "Blackbox API doesn't expose balance — see dashboard.",
  });
}

/**
 * Resolve a provider key's balance + validity. Always resolves (never throws)
 * so the admin UI can render a result or a graceful "n/a".
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
        return await openaiBalance(apiKey, baseURL);
      default:
        return base({ note: "Balance not supported for this provider." });
    }
  } catch (err) {
    return base({
      note: "Balance lookup failed.",
      error: err instanceof Error ? err.message : "unknown error",
    });
  }
}
