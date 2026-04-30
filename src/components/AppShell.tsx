"use client";

import { useCallback, useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import ChatArea from "./ChatArea";
import type { Session } from "@/lib/types";
import { cn } from "@/lib/cn";

export default function AppShell() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);

  const refreshSessions = useCallback(async (selectFirst = false) => {
    const res = await fetch("/api/sessions", { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as { sessions: Session[] };
    setSessions(json.sessions);
    setLoadingSessions(false);
    if (selectFirst && json.sessions.length > 0) {
      setActiveId((cur) => cur ?? json.sessions[0].id);
    }
    if (json.sessions.length === 0) {
      setActiveId(null);
    }
  }, []);

  useEffect(() => {
    refreshSessions(true);
  }, [refreshSessions]);

  const handleNewDirective = useCallback(async () => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) return;
    const json = (await res.json()) as { session: Session };
    setSessions((prev) => [json.session, ...prev]);
    setActiveId(json.session.id);
    setDrawerOpen(false);
  }, []);

  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
    setDrawerOpen(false);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (activeId === id) {
          setActiveId(next[0]?.id ?? null);
        }
        return next;
      });
    },
    [activeId],
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
    <div className="flex h-screen w-screen overflow-hidden bg-warp-bg text-white">
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
          onNewDirective={handleNewDirective}
          onSelect={handleSelect}
          onDelete={handleDelete}
          onCloseDrawer={() => setDrawerOpen(false)}
        />
      </aside>

      {/* Main column */}
      <main className="flex-1 min-w-0 flex flex-col">
        <ChatArea
          sessionId={activeId}
          onOpenDrawer={() => setDrawerOpen(true)}
          onNewDirective={handleNewDirective}
          onSessionUpdated={handleSessionUpdated}
        />
      </main>
    </div>
  );
}
