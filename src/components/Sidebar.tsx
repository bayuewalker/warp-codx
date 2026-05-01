"use client";

import { useEffect, useRef, useState } from "react";
import SessionRow from "./SessionRow";
import IssuesView from "./IssuesView";
import PRListView from "./PRListView";
import type { Session } from "@/lib/types";

type Props = {
  sessions: Session[];
  activeId: string | null;
  loading: boolean;
  error: string | null;
  creating: boolean;
  /**
   * Task #37 — server-driven pagination. The parent fetches the first
   * page of sessions on mount (10 by default) and exposes a callback
   * that asks the server for the next page when the user taps
   * "Show more". `hasMoreSessions` tells us whether to render the
   * affordance; `loadingMoreSessions` keeps the button from being
   * tapped twice while a fetch is in flight.
   */
  hasMoreSessions: boolean;
  loadingMoreSessions: boolean;
  /** Size of the next batch the server will return — used as the "N"
   *  in the "Show N more ▾" label so the affordance reads the same
   *  way it did before pagination. The server may return fewer if
   *  fewer remain, but this is the upper bound. */
  loadMoreBatchSize: number;
  onLoadMoreSessions: () => void;
  onNewDirective: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCloseDrawer: () => void;
  /** Phase 3a — opens the constitution settings drawer. */
  onOpenConstitutionSettings?: () => void;
};

/**
 * Drawer view mode — Phase 3b adds an `issues` mode that swaps the
 * sessions list for the IssuesView in place. The "+ New Directive"
 * button stays mounted in both modes since dispatching a directive
 * is the natural way to create more issues.
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
}: Props) {
  const [view, setView] = useState<ViewMode>("sessions");

  /**
   * Task #40 — auto-load older sessions when the user scrolls to the
   * bottom of the sidebar. An invisible sentinel is rendered just
   * below the last `SessionRow`; an `IntersectionObserver` watches it
   * and fires `onLoadMoreSessions` as soon as it scrolls into view.
   *
   * The "Show more" button below the sentinel stays mounted as a
   * keyboard-accessible fallback (for screen readers and users on
   * assistive tech where IntersectionObserver might not behave
   * predictably) and doubles as the visible loading indicator.
   *
   * The in-flight guard from Task #37 lives on the parent's
   * `loadMoreSessions`, so even if the observer briefly re-fires
   * while a fetch is pending, the parent will short-circuit. We also
   * skip wiring the observer up while `loadingMoreSessions` is true
   * so the callback isn't queued repeatedly during a slow fetch.
   */
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (!hasMoreSessions) return;
    if (loadingMoreSessions) return;
    if (typeof IntersectionObserver === "undefined") return;

    // Pin the observer to the drawer's scroll container so the
    // "in view" decision is made relative to the actual scrolling
    // surface, not the page viewport. This matches the spec
    // ("inside the drawer's scroll container") and keeps behavior
    // deterministic across layouts where the sidebar isn't anchored
    // to the viewport edge.
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
                {/* Task #40 — invisible IntersectionObserver target.
                    Auto-fires `onLoadMoreSessions` when it scrolls into
                    view so the user doesn't have to tap the button on
                    long histories. `aria-hidden` keeps it out of the
                    a11y tree; the button below remains the keyboard
                    affordance. */}
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
            {/* Task #41 — once the sidebar has paginated all the way to
                the oldest session, swap the silent end-of-list for a
                muted line so the user knows there's nothing more to
                load. Suppressed when there are zero sessions (the
                empty-state copy above already covers that) and while
                an initial load is still in flight (handled by the
                outer `loading` branch). */}
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

      {/* Phase 3a — sidebar footer with the constitution settings
          affordance. Kept compact (single line) and only mounted when
          a handler is provided so older callers aren't disturbed. */}
      {onOpenConstitutionSettings && (
        <div
          className="px-3 py-2"
          style={{ borderTop: "1px solid var(--border-faint)" }}
        >
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
        </div>
      )}
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
    case "bookmark":
      return (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
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
