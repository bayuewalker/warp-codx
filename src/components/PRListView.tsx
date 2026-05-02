"use client";

/**
 * Phase 3c — Drawer-mounted Pull Requests view. Same data source as
 * `PRListCard` (`/api/prs/list`) but full-height, with a Supabase
 * Realtime subscription on `public.pr_actions` so the list refreshes
 * when CMD acts in another session/tab.
 *
 * Visual parity with `IssuesView`: a back row + title + refresh
 * button, body scrolls, plain rows with the same accent classes
 * already in the design system.
 *
 * If the pre-req SQL did not add `pr_actions` to `supabase_realtime`,
 * the channel subscription will still mount but no INSERT events will
 * arrive. The manual `[Refresh]` button stays as the fallback per
 * Risk #2 in the task plan.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { prsFetch } from "@/lib/prs-fetch";
import { ADMIN_TOKEN_EVENT } from "@/lib/admin-token";
import { getBrowserSupabase } from "@/lib/supabase";
import EmptyState from "./EmptyState";

type ListedPR = {
  number: number;
  title: string;
  branch: string;
  author: string;
  tier: "MINOR" | "STANDARD" | "MAJOR" | null;
  additions: number;
  deletions: number;
  updatedAt: string;
  url: string;
  state: "open" | "closed";
};

type Props = {
  onBack: () => void;
};

export default function PRListView({ onBack }: Props) {
  const [prs, setPRs] = useState<ListedPR[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  // Track the latest refresh fn in a ref so the Realtime callback
  // always invokes the most recent closure without re-subscribing.
  const refreshRef = useRef<(() => Promise<void>) | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await prsFetch("/api/prs/list", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as
        | { prs?: ListedPR[]; truncated?: boolean; error?: string }
        | null;
      if (!res.ok) {
        setError(json?.error ?? `HTTP ${res.status}`);
        setPRs([]);
        setTruncated(false);
        return;
      }
      setPRs(json?.prs ?? []);
      setTruncated(!!json?.truncated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
      setPRs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  refreshRef.current = refresh;

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Realtime subscription on pr_actions inserts. Best-effort — if
  // the publication is missing, no events arrive and the manual
  // refresh button still works.
  useEffect(() => {
    let supabase;
    try {
      supabase = getBrowserSupabase();
    } catch {
      return;
    }
    const channel = supabase
      .channel("pr-actions-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "pr_actions",
        },
        () => {
          // Debounce-free: GitHub list endpoint is cheap (cached on
          // their side) and pr_actions inserts are infrequent.
          void refreshRef.current?.();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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
          Pull Requests
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          aria-label="Refresh PR list"
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

      <div className="flex-1 min-h-0 overflow-y-auto warp-scroll">
        {loading && prs.length === 0 ? (
          <div className="px-4 py-3 text-xs text-white/35">Loading…</div>
        ) : error ? (
          <div className="mx-2 my-2 px-3 py-2 rounded-md border-hair border-warp-amber/50 bg-warp-amber/10">
            <div className="text-[10px] uppercase tracking-[0.18em] text-warp-amber/90 mb-1">
              Failed to load PRs
            </div>
            <div className="text-[11px] text-white/80 leading-relaxed break-words">
              {error}
            </div>
          </div>
        ) : prs.length === 0 ? (
          <EmptyState
            icon="⌥"
            title="No open pull requests"
            subtitle={
              <>
                When WARP/* branches open PRs, they&apos;ll show here. Type{" "}
                <span className="text-warp-blue">&ldquo;cek pr&rdquo;</span>{" "}
                in chat to refresh from GitHub.
              </>
            }
          />
        ) : (
          <ul className="flex flex-col">
            {prs.map((pr) => (
              <li key={pr.number}>
                <PRRow pr={pr} />
              </li>
            ))}
            {truncated && (
              <li className="px-3 py-2 text-[10px] text-white/35 leading-relaxed">
                Showing first 30 — refine via GitHub.
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function PRRow({ pr }: { pr: ListedPR }) {
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block px-3 py-2.5 hover:bg-white/5 transition-colors border-b border-hair"
    >
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.14em] font-mono text-warp-blue">
          #{pr.number}
        </span>
        <span className="text-[9px] uppercase tracking-[0.18em] px-1.5 py-[1px] rounded border border-warp-blue/40 text-warp-blue bg-warp-blue-bg">
          {pr.state}
        </span>
        {pr.tier && (
          <span className="text-[9px] uppercase tracking-[0.18em] px-1.5 py-[1px] rounded border border-hair text-white/55">
            {pr.tier}
          </span>
        )}
        <span className="flex-1" />
        <span className="text-[10px] text-white/35 font-mono shrink-0">
          {formatRelative(pr.updatedAt)}
        </span>
      </div>
      <div className="text-[12px] text-white/85 leading-snug line-clamp-2">
        {pr.title}
      </div>
      <div className="text-[10px] text-white/45 font-mono mt-0.5">
        {pr.branch} · @{pr.author}
      </div>
    </a>
  );
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
