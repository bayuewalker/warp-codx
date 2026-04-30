"use client";

import SessionRow from "./SessionRow";
import type { Session } from "@/lib/types";

type Props = {
  sessions: Session[];
  activeId: string | null;
  loading: boolean;
  error: string | null;
  creating: boolean;
  onNewDirective: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCloseDrawer: () => void;
};

export default function Sidebar({
  sessions,
  activeId,
  loading,
  error,
  creating,
  onNewDirective,
  onSelect,
  onDelete,
  onCloseDrawer,
}: Props) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center justify-between px-4 py-3 border-b border-hair">
        <div className="flex items-baseline gap-2">
          <span className="text-warp-blue text-base">WARP</span>
          <span className="text-white/80 text-base tracking-tight">CodX</span>
        </div>
        <button
          type="button"
          aria-label="Close sessions"
          onClick={onCloseDrawer}
          className="md:hidden text-white/60 hover:text-white px-2 py-1 -mr-2"
        >
          ×
        </button>
      </header>

      <div className="px-3 pt-3 pb-2">
        <button
          type="button"
          onClick={onNewDirective}
          disabled={creating}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-md
            bg-warp-blue/10 hover:bg-warp-blue/20 active:bg-warp-blue/30
            disabled:opacity-50 disabled:cursor-not-allowed
            border-hair border-warp-blue/40 text-warp-blue
            text-sm transition-colors"
        >
          <span className="text-base leading-none">+</span>
          <span>{creating ? "Creating…" : "New directive"}</span>
        </button>
      </div>

      {error && (
        <div className="mx-3 mb-2 px-3 py-2 rounded-md border-hair border-warp-amber/50 bg-warp-amber/10">
          <div className="text-[10px] uppercase tracking-[0.18em] text-warp-amber/90 mb-1">
            Backend error
          </div>
          <div className="text-[11px] text-white/80 leading-relaxed break-words">
            {error}
          </div>
          {/(table|schema|relation).*(sessions|messages)/i.test(error) && (
            <div className="mt-2 text-[11px] text-white/55 leading-relaxed">
              Run the SQL in{" "}
              <span className="text-warp-blue">supabase.sql</span> in your
              Supabase project, then reload.
            </div>
          )}
        </div>
      )}

      <div className="px-3 pt-2 pb-1">
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">
          Sessions
        </div>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto warp-scroll px-2 pb-3">
        {loading ? (
          <div className="px-3 py-6 text-xs text-white/35">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="px-3 py-6 text-xs text-white/35 leading-relaxed">
            {error
              ? "No sessions to show — see the message above."
              : (
                <>
                  No sessions yet. Tap{" "}
                  <span className="text-warp-blue">+ New directive</span> to
                  start.
                </>
              )}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {sessions.map((s) => (
              <li key={s.id}>
                <SessionRow
                  session={s}
                  active={s.id === activeId}
                  onSelect={() => onSelect(s.id)}
                  onDelete={() => onDelete(s.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </nav>

      <footer className="px-4 py-3 border-t border-hair text-[10px] text-white/30">
        WalkerMind OS · v0.1
      </footer>
    </div>
  );
}
