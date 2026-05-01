"use client";

/**
 * Phase 3b — Issues view rendered inside the Sidebar drawer when the
 * "Issues" nav item is active. Replaces the sessions list (NOT a modal
 * overlay) per Design Decisions v1.0 — drawer nav items switch the
 * drawer's content area in place.
 *
 * Data source: GET /api/issues/list — proxied to GitHub
 * `bayuewalker/walkermind-os` filtered by the `forge-task` label.
 * GitHub is the source of truth for state (open/closed). The local
 * `issues_created` audit table is intentionally NOT cross-referenced
 * here — it has no state-transition tracking.
 *
 * The list refetches on mount and when the user taps "Refresh".
 * Empty / loading / error states all render plain rows so the drawer
 * stays visually consistent with the sessions list.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { issuesFetch } from "@/lib/issues-fetch";
import { ADMIN_TOKEN_EVENT } from "@/lib/admin-token";

type Issue = {
  number: number;
  title: string;
  state: "open" | "closed";
  url: string;
  labels: string[];
  createdAt: string;
};

type Props = {
  onBack: () => void;
};

export default function IssuesView({ onBack }: Props) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Latest refresh fn — used by the admin-token listener so it
  // always invokes the most recent closure without re-subscribing.
  const refreshRef = useRef<(() => Promise<void>) | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await issuesFetch("/api/issues/list", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as {
        issues?: Issue[];
        error?: string;
      } | null;
      if (!res.ok) {
        setError(json?.error ?? `HTTP ${res.status}`);
        setIssues([]);
        return;
      }
      setIssues(json?.issues ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
      setIssues([]);
    } finally {
      setLoading(false);
    }
  }, []);

  refreshRef.current = refresh;

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-fetch when Settings saves / clears the admin token (task #25).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => {
      void refreshRef.current?.();
    };
    window.addEventListener(ADMIN_TOKEN_EVENT, onChange);
    return () => {
      window.removeEventListener(ADMIN_TOKEN_EVENT, onChange);
    };
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Back row + title + refresh */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hair">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to sessions"
          className="header-icon-btn"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="text-[11px] uppercase tracking-[0.18em] text-white/65 flex-1">
          Issues
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          aria-label="Refresh issues list"
          className="header-icon-btn"
          disabled={loading}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={loading ? { opacity: 0.5 } : undefined}
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto warp-scroll">
        {loading && issues.length === 0 ? (
          <div className="px-4 py-3 text-xs text-white/35">Loading…</div>
        ) : error ? (
          <div className="mx-2 my-2 px-3 py-2 rounded-md border-hair border-warp-amber/50 bg-warp-amber/10">
            <div className="text-[10px] uppercase tracking-[0.18em] text-warp-amber/90 mb-1">
              Failed to load issues
            </div>
            <div className="text-[11px] text-white/80 leading-relaxed break-words">
              {error}
            </div>
          </div>
        ) : issues.length === 0 ? (
          <div className="px-4 py-3 text-xs text-white/35 leading-relaxed">
            No issues yet. Type{" "}
            <span className="text-warp-blue">
              &ldquo;buat issue untuk …&rdquo;
            </span>{" "}
            in chat to dispatch one.
          </div>
        ) : (
          <ul className="flex flex-col">
            {issues.map((it) => (
              <li key={it.number}>
                <IssueRow issue={it} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  const tier = inferTier(issue.labels);
  return (
    <a
      href={issue.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block px-3 py-2.5 hover:bg-white/5 transition-colors border-b border-hair"
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`text-[10px] uppercase tracking-[0.14em] font-mono ${
            issue.state === "open" ? "text-warp-teal" : "text-white/40"
          }`}
        >
          #{issue.number}
        </span>
        <span
          className={`text-[9px] uppercase tracking-[0.18em] px-1.5 py-[1px] rounded ${
            issue.state === "open"
              ? "border border-warp-teal/40 text-warp-teal bg-warp-teal-bg"
              : "border border-hair text-white/45"
          }`}
        >
          {issue.state}
        </span>
        {tier && (
          <span className="text-[9px] uppercase tracking-[0.18em] px-1.5 py-[1px] rounded border border-hair text-white/55">
            {tier}
          </span>
        )}
        <span className="flex-1" />
        <span className="text-[10px] text-white/35 font-mono shrink-0">
          {formatRelative(issue.createdAt)}
        </span>
      </div>
      <div className="text-[12px] text-white/85 leading-snug line-clamp-2">
        {issue.title}
      </div>
    </a>
  );
}

function inferTier(labels: string[]): string | null {
  const set = new Set(labels.map((l) => l.toLowerCase()));
  if (set.has("major")) return "MAJOR";
  if (set.has("standard")) return "STANDARD";
  if (set.has("minor")) return "MINOR";
  return null;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  return `${mo}mo`;
}
