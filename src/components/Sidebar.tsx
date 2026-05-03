"use client";

import { useEffect, useRef, useState } from "react";
import SessionRow from "./SessionRow";
import IssuesView from "./IssuesView";
import PRListView from "./PRListView";
import EmptyState from "./EmptyState";
import type { Session } from "@/lib/types";

type Props = {
  sessions: Session[];
  activeId: string | null;
  loading: boolean;
  error: string | null;
  creating: boolean;
  /**
   * Task #37 — server-driven pagination.
   */
  hasMoreSessions: boolean;
  loadingMoreSessions: boolean;
  loadMoreBatchSize: number;
  onLoadMoreSessions: () => void;
  onNewDirective: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCloseDrawer: () => void;
  /** Phase 3a — opens the constitution settings drawer. */
  onOpenConstitutionSettings?: () => void;
  /** Dev bypass / auth — identity label shown in the sidebar footer. */
  userEmail?: string | null;
  /** Label for the sign-out/sign-in button (default: "Sign out"). */
  signOutLabel?: string;
  /** Handler for the sign-out/sign-in footer button. */
  onSignOut?: () => void;
};

/**
 * Drawer view mode — Phase 3b adds an `issues` mode that swaps the
 * sessions list for the IssuesView in place.
 */
type ViewMode = "sessions" | "issues" | "prs";

export default function Sidebar({
  sessions,
  activeId,
  loading,
  error,
  creating,
  hasMoreSessions,
  loadingMoreSessions,
  loadMoreBatchSize,
  onLoadMoreSessions,
  onNewDirective,
  onSelect,
  onDelete,
  onCloseDrawer,
  onOpenConstitutionSettings,
  userEmail,
  signOutLabel = "Sign out",
  onSignOut,
}: Props) {
  const [view, setView] = useState<ViewMode>("sessions");

  /**
   * Task #40 — auto-load older sessions when the user scrolls to the
   * bottom of the sidebar.
   */
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (!hasMoreSessions) return;
    if (loadingMoreSessions) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onLoadMoreSessions();
            break;
          }
        }
      },
      {
        root: scrollContainerRef.current ?? null,
        rootMargin: "200px",
        threshold: 0,
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMoreSessions, loadingMoreSessions, onLoadMoreSessions]);

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
        <NavItem
          icon="grid"
          label="Sessions"
          active={view === "sessions"}
          onClick={() => setView("sessions")}
        />
        <NavItem
          icon="bookmark"
          label="Issues"
          active={view === "issues"}
          onClick={() => setView("issues")}
        />
        <NavItem
          icon="pr"
          label="Pull Requests"
          active={view === "prs"}
          onClick={() => setView("prs")}
        />
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

      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto warp-scroll"
      >
        {view === "issues" ? (
          <IssuesView onBack={() => setView("sessions")} />
        ) : view === "prs" ? (
          <PRListView onBack={() => setView("sessions")} />
        ) : loading ? (
          <div className="px-4 py-3 text-xs text-white/35">Loading…</div>
        ) : sessions.length === 0 ? (
          error ? (
            <div className="px-4 py-3 text-xs text-white/35 leading-relaxed">
              No sessions to show — see the message above.
            </div>
          ) : (
            <EmptyState
              icon="◇"
              title="No sessions yet"
              subtitle="Start a new directive to dispatch your first task to WARP🔹CMD."
              action={{ label: "+ New directive", onClick: onNewDirective }}
            />
          )
        ) : (
          <>
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
            {hasMoreSessions && (
              <>
                <div
                  ref={sentinelRef}
                  data-testid="sessions-load-more-sentinel"
                  aria-hidden="true"
                  style={{ height: 1 }}
                />
                <button
                  type="button"
                  onClick={onLoadMoreSessions}
                  disabled={loadingMoreSessions}
                  className="w-full text-left px-4 py-2 text-[11px]
                    text-white/45 hover:text-white/75
                    hover:bg-white/[0.04] transition-colors
                    disabled:opacity-60 disabled:cursor-wait"
                  aria-label={`Show ${loadMoreBatchSize} more sessions`}
                >
                  {loadingMoreSessions
                    ? "Loading…"
                    : `Show ${loadMoreBatchSize} more ▾`}
                </button>
              </>
            )}
            {!hasMoreSessions && (
              <div
                data-testid="sessions-end-of-history"
                className="px-4 py-3 text-[11px] text-white/35 text-center"
              >
                End of history — no earlier sessions
              </div>
            )}
          </>
        )}
      </div>

      {/* Sidebar footer — constitution settings + user identity */}
      <div
        className="px-3 py-2 flex flex-col gap-1"
        style={{ borderTop: "1px solid var(--border-faint)" }}
      >
        {onOpenConstitutionSettings && (
          <button
            type="button"
            className="cset-trigger"
            onClick={onOpenConstitutionSettings}
            aria-label="Open constitution settings"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              width={12}
              height={12}
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            CONSTITUTION
          </button>
        )}

        {onSignOut && (
          <div className="px-0 flex items-center justify-between gap-2">
            <span
              className="text-[10px] uppercase tracking-[0.18em] text-white/45 truncate"
              title={userEmail ?? undefined}
              suppressHydrationWarning
            >
              {userEmail ?? "Signed in"}
            </span>
            <button
              type="button"
              onClick={onSignOut}
              className="text-[10px] uppercase tracking-[0.18em]
                text-white/45 hover:text-white/80 transition-colors
                shrink-0"
            >
              {signOutLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

type IconName = "home" | "grid" | "bookmark" | "pr" | "clock";

function NavItem({
  icon,
  label,
  disabled,
  active,
  onClick,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="nav-item"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      style={
        disabled
          ? { opacity: 0.5, cursor: "not-allowed" }
          : active
            ? { color: "var(--warp-text)", background: "rgba(255,255,255,0.04)" }
            : undefined
      }
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      );
    case "grid":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      );
    case "bookmark":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      );
    case "pr":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
      );
    case "clock":
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
  }
}
