"use client";

import { useCallback, useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import ChatArea from "./ChatArea";
import ConstitutionWarningBanner from "./ConstitutionWarningBanner";
import ConstitutionSettings from "./ConstitutionSettings";
import type { Session } from "@/lib/types";
import { cn } from "@/lib/cn";

/**
 * Task #37 — page size for the sidebar's session list. Mirrors
 * `DEFAULT_LIMIT` in `src/app/api/sessions/route.ts`. Bumping one
 * without the other still works (the API caps at MAX_LIMIT and the
 * client always trusts the server's `hasMore`/`nextCursor`), but
 * keeping them aligned keeps the "Show more" affordance honest.
 */
const SESSIONS_PAGE_SIZE = 10;

type SessionsPage = {
  sessions: Session[];
  hasMore: boolean;
  nextCursor: string | null;
  nextCursorId: string | null;
};

export default function AppShell() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  // Tuple cursor — created_at + id — so page boundaries are stable
  // even when two sessions share the exact same `created_at`. See the
  // route-level docstring in `src/app/api/sessions/route.ts`.
  const [sessionsCursor, setSessionsCursor] = useState<string | null>(null);
  const [sessionsCursorId, setSessionsCursorId] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refreshSessions = useCallback(async (selectFirst = false) => {
    try {
      const res = await fetch(
        `/api/sessions?limit=${SESSIONS_PAGE_SIZE}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}) as { error?: string });
        const msg =
          (errJson && (errJson as { error?: string }).error) ||
          `Failed to load sessions (${res.status})`;
        setSessionsError(msg);
        return;
      }
      const json = (await res.json()) as SessionsPage;
      setSessions(json.sessions);
      setHasMoreSessions(Boolean(json.hasMore));
      setSessionsCursor(json.nextCursor ?? null);
      setSessionsCursorId(json.nextCursorId ?? null);
      setSessionsError(null);
      if (selectFirst && json.sessions.length > 0) {
        setActiveId((cur) => cur ?? json.sessions[0].id);
      }
      if (json.sessions.length === 0) {
        setActiveId(null);
      }
    } catch (err) {
      setSessionsError(
        err instanceof Error ? err.message : "Network error loading sessions",
      );
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  /**
   * Task #37 — fetch the next batch of older sessions and append.
   *
   * Idempotent against re-entry (guarded by `loadingMoreSessions`) and
   * de-dupes on `id` in case a concurrent insert (POST or realtime
   * later) prepended an item we already hold. The server is the source
   * of truth for `hasMore` / `nextCursor`. Clears any stale
   * `sessionsError` on success so a recovered fetch doesn't keep the
   * banner visible.
   */
  const loadMoreSessions = useCallback(async () => {
    if (loadingMoreSessions || !hasMoreSessions || !sessionsCursor) return;
    setLoadingMoreSessions(true);
    try {
      const params = new URLSearchParams({
        limit: String(SESSIONS_PAGE_SIZE),
        before: sessionsCursor,
      });
      if (sessionsCursorId) params.set("beforeId", sessionsCursorId);
      const res = await fetch(`/api/sessions?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}) as { error?: string });
        const msg =
          (errJson && (errJson as { error?: string }).error) ||
          `Failed to load more sessions (${res.status})`;
        setSessionsError(msg);
        return;
      }
      const json = (await res.json()) as SessionsPage;
      setSessions((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        const additions = json.sessions.filter((s) => !seen.has(s.id));
        return [...prev, ...additions];
      });
      setHasMoreSessions(Boolean(json.hasMore));
      setSessionsCursor(json.nextCursor ?? null);
      setSessionsCursorId(json.nextCursorId ?? null);
      setSessionsError(null);
    } catch (err) {
      setSessionsError(
        err instanceof Error
          ? err.message
          : "Network error loading more sessions",
      );
    } finally {
      setLoadingMoreSessions(false);
    }
  }, [loadingMoreSessions, hasMoreSessions, sessionsCursor, sessionsCursorId]);

  useEffect(() => {
    refreshSessions(true);
  }, [refreshSessions]);

  const handleNewDirective = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setSessionsError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}) as { error?: string });
        const msg =
          (errJson && (errJson as { error?: string }).error) ||
          `Could not create session (${res.status})`;
        setSessionsError(msg);
        return;
      }
      const json = (await res.json()) as { session: Session };
      setSessions((prev) => [json.session, ...prev]);
      setActiveId(json.session.id);
      setDrawerOpen(false);
    } catch (err) {
      setSessionsError(
        err instanceof Error ? err.message : "Network error creating session",
      );
    } finally {
      setCreating(false);
    }
  }, [creating]);

  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
    setDrawerOpen(false);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      // Snapshot for rollback if the request fails.
      let prevSessions: Session[] = [];
      let prevActiveId: string | null = null;
      setSessions((prev) => {
        prevSessions = prev;
        return prev.filter((s) => s.id !== id);
      });
      setActiveId((cur) => {
        prevActiveId = cur;
        if (cur !== id) return cur;
        const next = prevSessions.filter((s) => s.id !== id);
        return next[0]?.id ?? null;
      });

      try {
        const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      } catch {
        // Roll back on failure.
        setSessions(prevSessions);
        setActiveId(prevActiveId);
      }
    },
    [],
  );

  const handleSessionUpdated = useCallback((updated: Session) => {
    setSessions((prev) => {
      const exists = prev.some((s) => s.id === updated.id);
      if (!exists) return [updated, ...prev];
      return prev
        .map((s) => (s.id === updated.id ? { ...s, ...updated } : s))
        .sort(
          (a, b) =>
            new Date(b.updated_at ?? b.created_at).getTime() -
            new Date(a.updated_at ?? a.created_at).getTime(),
        );
    });
  }, []);

  return (
    <div className="flex warp-h-screen w-screen overflow-hidden bg-warp-bg text-white">
      {/* Mobile drawer overlay */}
      <div
        className={cn(
          "md:hidden fixed inset-0 z-30 bg-black/60 transition-opacity",
          drawerOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none",
        )}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar — fixed-width column on desktop, drawer on mobile */}
      <aside
        className={cn(
          "fixed md:static inset-y-0 left-0 z-40 w-[86%] max-w-[320px]",
          "md:w-[280px] md:max-w-none md:flex",
          "bg-warp-bg border-r border-hair flex flex-col",
          "transform-gpu transition-transform duration-200 ease-out",
          drawerOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
        aria-label="Sessions"
      >
        <Sidebar
          sessions={sessions}
          activeId={activeId}
          loading={loadingSessions}
          error={sessionsError}
          creating={creating}
          hasMoreSessions={hasMoreSessions}
          loadingMoreSessions={loadingMoreSessions}
          loadMoreBatchSize={SESSIONS_PAGE_SIZE}
          onLoadMoreSessions={loadMoreSessions}
          onNewDirective={handleNewDirective}
          onSelect={handleSelect}
          onDelete={handleDelete}
          onCloseDrawer={() => setDrawerOpen(false)}
          onOpenConstitutionSettings={() => {
            setDrawerOpen(false);
            setSettingsOpen(true);
          }}
        />
      </aside>

      <main className="flex-1 min-w-0 flex flex-col relative">
        <ConstitutionWarningBanner sessionId={activeId} />
        <ChatArea
          sessionId={activeId}
          sessionLabel={
            sessions.find((s) => s.id === activeId)?.label ?? null
          }
          onOpenDrawer={() => setDrawerOpen(true)}
          onNewDirective={handleNewDirective}
          onSessionUpdated={handleSessionUpdated}
        />
      </main>
      <ConstitutionSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
