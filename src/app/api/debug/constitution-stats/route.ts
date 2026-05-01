import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/debug/constitution-stats
 *
 * Per-path cache hit/miss/error counts and average duration over the
 * last 24h, sourced from constitution_fetch_log. This is the verification
 * mechanism for the cache hit rate target (>80%).
 *
 * Gated to NODE_ENV !== "production" by default. In production, set
 * DEBUG_CONSTITUTION_STATS=1 to enable. In either case there's no PII
 * or secret data here.
 */
export async function GET() {
  const isProd = process.env.NODE_ENV === "production";
  const enabled = !isProd || process.env.DEBUG_CONSTITUTION_STATS === "1";
  if (!enabled) {
    return NextResponse.json(
      { error: "debug stats disabled in production" },
      { status: 404 },
    );
  }

  const supabase = getServerSupabase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("constitution_fetch_log")
    .select("path, status, duration_ms, fetched_at")
    .gte("fetched_at", since);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Bucket = {
    path: string;
    hit_cache: number;
    miss_fetch: number;
    error_fallback: number;
    total: number;
    avgDurationMs: number;
    hitRate: number;
  };
  const byPath = new Map<
    string,
    { hit_cache: number; miss_fetch: number; error_fallback: number; durSum: number; n: number }
  >();
  for (const row of (data ?? []) as Array<{
    path: string;
    status: string;
    duration_ms: number | null;
  }>) {
    const b = byPath.get(row.path) ?? {
      hit_cache: 0,
      miss_fetch: 0,
      error_fallback: 0,
      durSum: 0,
      n: 0,
    };
    if (row.status === "hit_cache") b.hit_cache += 1;
    else if (row.status === "miss_fetch") b.miss_fetch += 1;
    else if (row.status === "error_fallback") b.error_fallback += 1;
    if (typeof row.duration_ms === "number") {
      b.durSum += row.duration_ms;
      b.n += 1;
    }
    byPath.set(row.path, b);
  }

  const perPath: Bucket[] = Array.from(byPath.entries())
    .map(([path, b]) => {
      const total = b.hit_cache + b.miss_fetch + b.error_fallback;
      return {
        path,
        hit_cache: b.hit_cache,
        miss_fetch: b.miss_fetch,
        error_fallback: b.error_fallback,
        total,
        avgDurationMs: b.n > 0 ? Math.round(b.durSum / b.n) : 0,
        hitRate: total > 0 ? Math.round((b.hit_cache / total) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  const totals = perPath.reduce(
    (acc, p) => {
      acc.hit_cache += p.hit_cache;
      acc.miss_fetch += p.miss_fetch;
      acc.error_fallback += p.error_fallback;
      acc.total += p.total;
      return acc;
    },
    { hit_cache: 0, miss_fetch: 0, error_fallback: 0, total: 0 },
  );
  const overallHitRate =
    totals.total > 0
      ? Math.round((totals.hit_cache / totals.total) * 1000) / 10
      : 0;

  return NextResponse.json({
    windowHours: 24,
    since,
    overall: { ...totals, hitRate: overallHitRate },
    perPath,
  });
}
