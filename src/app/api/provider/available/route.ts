import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roles";
import { resolveProviderChain, type ProviderCandidate } from "@/lib/provider-chain";
import type { Provider } from "@/lib/provider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/provider/available
 *
 * Which LLM providers are configured AND reachable right now — the data behind
 * the composer model picker, so it only ever offers models a live provider can
 * actually serve. Resolves the same failover chain the chat route uses, then
 * pings each distinct provider's OpenAI-compatible `/models` endpoint (cheap,
 * token-free) in parallel:
 *
 *   - 2xx / 404      → "online"   (reachable; key accepted)
 *   - 401/402/403/429/5xx → "degraded" (reachable but key rejected / limited)
 *   - network / timeout   → "offline"
 *
 * Cached in-process for a short TTL so polling pickers can't DoS the providers.
 */
type Health = "online" | "degraded" | "offline";
type ProviderAvail = { provider: Provider; status: Health };

const TTL_MS = 20_000;
const PROBE_TIMEOUT_MS = 4_000;
let cache: { value: { providers: ProviderAvail[] }; at: number } | null = null;

async function probe(cand: ProviderCandidate): Promise<Health> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${cand.baseURL.replace(/\/$/, "")}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${cand.apiKey}`, ...cand.defaultHeaders },
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.ok || res.status === 404) return "online";
    if (res.status >= 400) return "degraded"; // reachable, but key/limit issue
    return "online";
  } catch {
    return "offline";
  } finally {
    clearTimeout(timer);
  }
}

async function compute(): Promise<{ providers: ProviderAvail[] }> {
  const chain = await resolveProviderChain();
  // One probe per distinct provider (first candidate per provider wins).
  const seen = new Set<Provider>();
  const firsts: ProviderCandidate[] = [];
  for (const c of chain) {
    if (!seen.has(c.provider)) {
      seen.add(c.provider);
      firsts.push(c);
    }
  }
  const providers = await Promise.all(
    firsts.map(async (c) => ({ provider: c.provider, status: await probe(c) })),
  );
  return { providers };
}

export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(cache.value);
  }
  try {
    const value = await compute();
    cache = { value, at: Date.now() };
    return NextResponse.json(value);
  } catch {
    // Degrade to "nothing known" rather than erroring the picker.
    return NextResponse.json({ providers: [] }, { status: 200 });
  }
}
