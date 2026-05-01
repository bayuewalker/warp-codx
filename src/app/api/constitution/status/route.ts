import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import {
  CACHE_TTL_MS,
  TIER1_PATHS_GLOBAL,
  resolveProjectRoot,
  FALLBACK_PROJECT_ROOT,
} from "@/lib/constitution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type FileSummary = {
  path: string;
  cached: boolean;
  ageMs: number | null;
  sizeBytes: number | null;
  lastStatus: string | null;
  lastFetchedAt: string | null;
  lastError: string | null;
};

/**
 * GET /api/constitution/status
 *
 * Returns the badge state and per-Tier-1-file summary used by the header
 * badge and the bottom sheet. Reads from constitution_cache and
 * constitution_fetch_log only — does not call GitHub.
 */
export async function GET() {
  const supabase = getServerSupabase();

  // Resolve project root from cache only — never call GitHub from here.
  let projectRoot = FALLBACK_PROJECT_ROOT;
  try {
    const { data } = await supabase
      .from("constitution_cache")
      .select("content")
      .eq("path", "PROJECT_REGISTRY.md")
      .maybeSingle();
    if (data?.content) {
      const m = (data.content as string).match(
        /projects\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/,
      );
      if (m) projectRoot = m[0];
    }
  } catch {
    /* keep fallback */
  }

  // If we have at least one cached row, allow resolveProjectRoot via the
  // normal path too (it goes through fetchConstitutionFile which is cache
  // first). We don't await it; cache-derived projectRoot above is enough.
  void resolveProjectRoot;

  const tier1Paths = [
    ...TIER1_PATHS_GLOBAL,
    `${projectRoot}/state/PROJECT_STATE.md`,
  ];

  const summaries: FileSummary[] = await Promise.all(
    tier1Paths.map(async (path) => {
      const [{ data: cacheRow }, { data: logRow }] = await Promise.all([
        supabase
          .from("constitution_cache")
          .select("size_bytes, fetched_at")
          .eq("path", path)
          .maybeSingle(),
        supabase
          .from("constitution_fetch_log")
          .select("status, fetched_at, error_message")
          .eq("path", path)
          .order("fetched_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const cached = !!cacheRow;
      const fetchedAt = cacheRow?.fetched_at ?? null;
      const ageMs = fetchedAt
        ? Date.now() - new Date(fetchedAt).getTime()
        : null;

      return {
        path,
        cached,
        ageMs,
        sizeBytes: cacheRow?.size_bytes ?? null,
        lastStatus: logRow?.status ?? null,
        lastFetchedAt: logRow?.fetched_at ?? null,
        lastError: logRow?.error_message ?? null,
      };
    }),
  );

  // Derive overall state.
  const fiveMinAgo = Date.now() - CACHE_TTL_MS;
  const recentErrors = summaries.filter(
    (s) =>
      s.lastStatus === "error_fallback" &&
      s.lastFetchedAt &&
      new Date(s.lastFetchedAt).getTime() >= fiveMinAgo,
  ).length;
  const anyCached = summaries.some((s) => s.cached);

  let state: "synced" | "stale" | "offline" = "synced";
  if (!anyCached) {
    state = "offline";
  } else if (recentErrors > 0) {
    state = "stale";
  } else {
    const allFresh = summaries.every(
      (s) =>
        s.cached &&
        typeof s.ageMs === "number" &&
        s.ageMs < CACHE_TTL_MS,
    );
    state = allFresh ? "synced" : "stale";
  }

  return NextResponse.json({
    state,
    projectRoot,
    ttlMs: CACHE_TTL_MS,
    files: summaries,
    checkedAt: new Date().toISOString(),
  });
}
