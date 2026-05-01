import { NextResponse } from "next/server";
import {
  fetchConstitutionFile,
  resolveProjectRoot,
  TIER1_PATHS_GLOBAL,
} from "@/lib/constitution";
import { sendPushToAll } from "@/lib/push-server";
import { writeTaskCompleteMessage } from "@/lib/task-complete-write";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RefreshBody = {
  /**
   * Phase 3.5 (option a) — when present, the route emits a
   * TASK_COMPLETE marker into this chat session after the refresh
   * completes successfully. Optional so legacy callers (Settings
   * panel, slash command) keep working unchanged.
   */
  sessionId?: string | null;
};

/**
 * POST /api/constitution/refresh
 *
 * Force-refresh all Tier 1 files. Returns per-path status so the composer
 * (after a `/refresh constitution` slash command) and the Settings panel
 * can show what happened.
 *
 * Body (all fields optional):
 *   { sessionId?: string | null }
 */
export async function POST(req: Request) {
  // Body is optional — historically this route accepted no body at
  // all. Tolerate empty/invalid bodies by treating sessionId as null.
  let sessionId: string | null = null;
  try {
    const raw = (await req.json()) as RefreshBody | null | undefined;
    if (raw && typeof raw.sessionId === "string" && raw.sessionId.length > 0) {
      sessionId = raw.sessionId;
    }
  } catch {
    /* no body / non-JSON body — fine, sessionId stays null */
  }

  // Re-resolve project root with forceRefresh so we always get the freshest
  // PROJECT_REGISTRY.md before fetching the project-specific state file.
  const registry = await fetchConstitutionFile("PROJECT_REGISTRY.md", {
    forceRefresh: true,
  }).catch((err) => ({
    path: "PROJECT_REGISTRY.md",
    status: "error_fallback" as const,
    sizeBytes: 0,
    sha: "",
    fetchedAt: new Date().toISOString(),
    content: "",
    errorMessage: err instanceof Error ? err.message : "fetch_failed",
  }));

  let projectRoot = "projects/polymarket/polyquantbot";
  try {
    const r = await resolveProjectRoot();
    projectRoot = r.projectRoot;
  } catch {
    /* keep fallback */
  }

  const tier1 = [
    ...TIER1_PATHS_GLOBAL.filter((p) => p !== "PROJECT_REGISTRY.md"),
    `${projectRoot}/state/PROJECT_STATE.md`,
  ];

  const results = await Promise.allSettled(
    tier1.map((p) => fetchConstitutionFile(p, { forceRefresh: true })),
  );

  const perPath = [
    {
      path: registry.path,
      status: registry.status,
      sizeBytes: registry.sizeBytes,
      errorMessage:
        "errorMessage" in registry ? registry.errorMessage : undefined,
    },
    ...results.map((r, i) => {
      if (r.status === "fulfilled") {
        return {
          path: r.value.path,
          status: r.value.status,
          sizeBytes: r.value.sizeBytes,
          errorMessage: r.value.errorMessage,
        };
      }
      return {
        path: tier1[i],
        status: "error_fallback" as const,
        sizeBytes: 0,
        errorMessage:
          r.reason instanceof Error ? r.reason.message : String(r.reason),
      };
    }),
  ];

  const ok = perPath.filter((p) => p.status === "miss_fetch").length;
  const errors = perPath.filter((p) => p.status === "error_fallback").length;

  // Phase 4 — fire-and-forget push notification. Detached (`void`)
  // so the response is never blocked on Supabase select + push fanout.
  // `sendPushToAll` swallows every error internally; the `.catch` here
  // is a defensive guard against any future regression.
  void sendPushToAll({
    title: "🔄 Constitution refreshed",
    body: `${ok} files updated · walkermind-os`,
    tag: "constitution-refresh",
    url: null,
  }).catch((err) =>
    console.error(
      `[push] constitution-refresh dispatch escaped: ${
        err instanceof Error ? err.message : "unknown"
      }`,
    ),
  );

  // Phase 3.5 (option a) — fire-and-forget TASK_COMPLETE marker into
  // the originating chat session, but ONLY when (a) the caller passed
  // a sessionId AND (b) the refresh actually updated files. A refresh
  // that only produced error_fallback rows isn't a success worth
  // announcing.
  if (sessionId && ok > 0) {
    const refreshedAt = new Date().toISOString();
    void writeTaskCompleteMessage(sessionId, {
      kind: "constitution_refreshed",
      refresh: { filesUpdated: ok, lastSyncIso: refreshedAt },
    }).catch((err) =>
      console.error(
        `[task-complete-write] constitution-refresh dispatch escaped: ${
          err instanceof Error ? err.message : "unknown"
        }`,
      ),
    );
  }

  return NextResponse.json({
    refreshedAt: new Date().toISOString(),
    projectRoot,
    summary: { ok, errors, total: perPath.length },
    files: perPath,
  });
}
