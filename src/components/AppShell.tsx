"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "./Sidebar";
import ChatArea from "./ChatArea";
import ConstitutionWarningBanner from "./ConstitutionWarningBanner";
import ConstitutionSettings from "./ConstitutionSettings";
import type { Session } from "@/lib/types";
import { cn } from "@/lib/cn";
import { getBrowserSupabase, setBrowserSupabaseConfig } from "@/lib/supabase";

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

type AuthState =
  | { kind: "checking" }
  | { kind: "guest" }
  | { kind: "ready"; userId: string; email: string | null };

export default function AppShell() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [auth, setAuth] = useState<AuthState>({ kind: "checking" });
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  // Tuple cursor — created_at + id — so page boundaries are stable
  // even when two sessions share the exact same `created_at`.
  const [sessionsCursor, setSessionsCursor] = useState<string | null>(null);
  const [sessionsCursorId, setSessionsCursorId] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    const redirect = () => router.replace("/sign-in");

    const initAuth = async () => {
      // Fetch public Supabase config from the server at runtime. This avoids
      // needing NEXT_PUBLIC_* vars baked into the bundle at Docker build time —
      // fly.io secrets are only available at runtime, not during `npm run build`.
      try {
        const res = await fetch("/api/config");
        if (res.ok) {
          const { supabaseUrl, supabaseAnonKey } = await res.json() as {
            supabaseUrl: string;
            supabaseAnonKey: string;
          };
          if (supabaseUrl && supabaseAnonKey) {
            setBrowserSupabaseConfig(supabaseUrl, supabaseAnonKey);
          }
        }
      } catch {
        // If config fetch fails, try with build-time vars (local dev fallback).
      }

      const sb = getBrowserSupabase();
      const { data } = await sb.auth.getSession();
      const user = data.session?.user;
      if (user) {
        setAuth({ kind: "ready", userId: user.id, email: user.email ?? null });
      } else {
        setAuth({ kind: "guest" });
        // Do NOT redirect — guests see the landing page and sign in when they
        // try to use a feature.
      }

      const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          setAuth({ kind: "ready", userId: session.user.id, email: session.user.email ?? null });
        } else {
          setAuth({ kind: "guest" });
        }
      });
      return () => subscription.unsubscribe();
    };

    let cleanup: (() => void) | undefined;
    initAuth()
      .then((fn) => { cleanup = fn; })
      .catch(() => {
        // On any init error (e.g. Supabase config missing) show the app as
        // guest — do NOT redirect. Redirecting to /sign-in would break the
        // soft auth gate for users who haven't signed in yet.
        setAuth({ kind: "guest" });
      });
    return () => cleanup?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignOut = useCallback(async () => {
    try { await getBrowserSupabase().auth.signOut(); } catch { /* ignore */ }
    router.replace("/sign-in");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (auth.kind !== "checking") refreshSessions(true);
  }, [auth.kind, refreshSessions]);

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


  // Before mount or while checking auth: show minimal shell (no hydration mismatch).
  if (!mounted || auth.kind === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-warp-bg text-white">
        <div className="text-xs uppercase tracking-[0.32em] text-white/45">
          {mounted ? "Checking session…" : null}
        </div>
      </div>
    );
  }

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
          userEmail={auth.kind === "ready" ? auth.email : "Guest mode"}
          onSignOut={handleSignOut}
          signOutLabel={auth.kind === "guest" ? "Sign in" : "Sign out"}
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
          isGuest={auth.kind === "guest"}
        />
      </main>
      <ConstitutionSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
