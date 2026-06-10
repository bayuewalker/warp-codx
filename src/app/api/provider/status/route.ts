import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roles";
import { resolveProviderChain } from "@/lib/provider-chain";
import { getModelForProvider, formatModelSlug } from "@/lib/models";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/provider/status
 *
 * Lightweight, realtime-ish health probe for the active LLM provider — the
 * data behind the top-bar connection LED (see ProviderStatusBar.tsx).
 *
 * It resolves the same failover chain the chat route uses, then pings the top
 * candidate's OpenAI-compatible `/models` endpoint (a cheap, token-free GET) to
 * confirm the provider is reachable and the key is accepted:
 *
 *   - 2xx / 404            → "online"   (reachable; 404 just means this provider
 *                                        exposes models under a different path)
 *   - 401 / 403            → "degraded" (reachable but the key was rejected)
 *   - 402 / 429            → "degraded" (out of credit / rate-limited)
 *   - 5xx                  → "degraded" (provider upstream issue)
 *   - network error / timeout → "offline"
 *   - no provider/key at all  → "offline" (reason: "no-providers")
 *
 * The probe result is cached in-process for a short TTL so a roomful of polling
 * clients can't turn the LED into a DoS against the provider.
 */
type Status = "online" | "degraded" | "offline";

type ProviderStatus = {
  status: Status;
  reason: string;
  provider: string | null;
  model: string | null;
  providerCount: number;
  checkedAt: string;
};

const TTL_MS = 20_000;
const PROBE_TIMEOUT_MS = 4_000;
let cache: { value: ProviderStatus; at: number } | null = null;

async function probe(): Promise<ProviderStatus> {
  const chain = await resolveProviderChain();
  const now = new Date().toISOString();

  if (chain.length === 0) {
    return {
      status: "offline",
      reason: "no-providers",
      provider: null,
      model: null,
      providerCount: 0,
      checkedAt: now,
    };
  }

  const top = chain[0];
  const model = formatModelSlug(getModelForProvider(top.provider, "cmd"));
  const base: Omit<ProviderStatus, "status" | "reason"> = {
    provider: top.provider,
    model,
    providerCount: chain.length,
    checkedAt: now,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${top.baseURL.replace(/\/$/, "")}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${top.apiKey}`,
        ...top.defaultHeaders,
      },
      signal: controller.signal,
      cache: "no-store",
    });

    if (res.ok || res.status === 404) {
      return { ...base, status: "online", reason: "ok" };
    }
    if (res.status === 401 || res.status === 403) {
      return { ...base, status: "degraded", reason: "auth" };
    }
    if (res.status === 402 || res.status === 429) {
      return { ...base, status: "degraded", reason: "limit" };
    }
    if (res.status >= 500) {
      return { ...base, status: "degraded", reason: "upstream" };
    }
    // Any other 4xx: the server answered, so the connection itself is fine.
    return { ...base, status: "online", reason: `http-${res.status}` };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError" ? "timeout" : "network";
    return { ...base, status: "offline", reason };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.value);
  }

  try {
    const value = await probe();
    cache = { value, at: Date.now() };
    return NextResponse.json(value);
  } catch (err) {
    const message = err instanceof Error ? err.message : "probe failed";
    return NextResponse.json(
      {
        status: "offline" as const,
        reason: "error",
        provider: null,
        model: null,
        providerCount: 0,
        checkedAt: new Date().toISOString(),
        error: message,
      },
      { status: 200 },
    );
  }
}
