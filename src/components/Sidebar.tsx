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
    <div className="flex flex-col h-full min-h-0 drawer-content">
      <div className="md:hidden flex justify-end -mt-1 -mr-1 mb-1">
        <button
          type="button"
          aria-label="Close sessions"
          onClick={onCloseDrawer}
          className="header-icon-btn"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="6" y1="18" x2="18" y2="6" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        onClick={onNewDirective}
        disabled={creating}
        className="new-env-btn"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        {creating ? "Creating…" : "New Directive"}
      </button>

      <nav aria-label="Primary">
        <NavItem icon="home" label="Home" />
        <NavItem icon="grid" label="Sessions" />
        <NavItem icon="pr" label="Pull Requests" disabled />
        <NavItem icon="clock" label="Job History" disabled />
      </nav>

      {error && (
        <div className="mx-2 my-2 px-3 py-2 rounded-md border-hair border-warp-amber/50 bg-warp-amber/10">
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

      <button type="button" className="drawer-section">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        bayuewalker/walkermind-os
      </button>

      <div className="flex-1 min-h-0 overflow-y-auto warp-scroll">
        {loading ? (
          <div className="px-4 py-3 text-xs text-white/35">Loading…</div>
        ) : sessions.length === 0 ? (
          <div className="px-4 py-3 text-xs text-white/35 leading-relaxed">
            {error
              ? "No sessions to show — see the message above."
              : (
                <>
                  No sessions yet. Tap{" "}
                  <span className="text-warp-blue">+ New Directive</span> to
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
      </div>
    </div>
  );
}

type IconName = "home" | "grid" | "pr" | "clock";

function NavItem({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="nav-item"
      onClick={onClick}
      disabled={disabled}
      style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
      title={disabled ? `${label} (coming soon)` : label}
    >
      <NavIcon name={icon} />
      <span>{label}</span>
    </button>
  );
}

function NavIcon({ name }: { name: IconName }) {
  switch (name) {
    case "home":
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      );
    case "grid":
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      );
    case "pr":
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
      );
    case "clock":
    default:
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
  }
}
