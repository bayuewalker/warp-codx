"use client";

/**
 * Phase 3c — Inline PR list card rendered when CMD emits
 *   <!-- PR_ACTION: list -->
 *
 * Fetches `/api/prs/list` once on mount. Renders an at-a-glance row
 * per open WARP/* PR with [REFRESH] in the header. Each row is a
 * tap-to-open trigger that mounts an inline `PRCard` (in collapsed
 * state) below it. We intentionally do NOT subscribe to Supabase
 * Realtime here — the chat surface is read-once per assistant turn
 * and a re-render cascade would jitter the chat scroll. The drawer
 * `PRListView` is the one that subscribes.
 *
 * Visual: same purple-bordered shell as `PRCard`, no new tokens.
 */

import { useCallback, useEffect, useState } from "react";
import { prsFetch } from "@/lib/prs-fetch";
import PRCard, { type PRInitialIntent } from "./PRCard";

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

type ListResponse = { prs: ListedPR[]; truncated: boolean };

type Props = {
  sessionId: string | null;
};

export default function PRListCard({ sessionId }: Props) {
  const [prs, setPRs] = useState<ListedPR[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [openNumber, setOpenNumber] = useState<number | null>(null);
  /**
   * Which mode the inline `PRCard` opens into for the currently
   * expanded row. `detail` is the View-details flow (read-only
   * inspection). `merge` opens with gates expanded and the merge
   * button ready to confirm. `close` auto-opens the close-reason
   * textarea. The card itself still owns the actual POSTs and the
   * server still enforces gates / requires a close reason — these
   * shortcuts only skip the operator's first tap on "View details".
   */
  const [openIntent, setOpenIntent] = useState<PRInitialIntent>("detail");

  /**
   * Toggle the inline detail row. Tapping the same row again with the
   * same intent collapses it; tapping with a new intent re-opens with
   * the new intent so the operator can switch flows without first
   * closing the row.
   */
  const openRow = (number: number, intent: PRInitialIntent) => {
    setOpenIntent(intent);
    setOpenNumber((cur) =>
      cur === number && openIntent === intent ? null : number,
    );
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await prsFetch("/api/prs/list", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as
        | (ListResponse & { error?: string })
        | null;
      if (!res.ok || !json || !Array.isArray(json.prs)) {
        setError(json?.error ?? `HTTP ${res.status}`);
        setPRs([]);
        setTruncated(false);
        return;
      }
      setPRs(json.prs);
      setTruncated(!!json.truncated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "network error");
      setPRs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div
      className="my-3 rounded-md overflow-hidden"
      style={{
        background: "var(--bg-elev-1)",
        border: "1px solid var(--border-soft)",
        borderLeft: "2px solid var(--warp-purple)",
      }}
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-hair">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/65">
          <span aria-hidden="true">📋</span>
          <span>
            Open PRs · WARP/* · {prs.length}
            {truncated ? "+" : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] rounded border border-hair text-white/55 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      <div>
        {loading && prs.length === 0 ? (
          <div className="px-4 py-3 text-[12px] text-white/45">Loading PRs…</div>
        ) : error ? (
          <div className="mx-3 my-3 px-3 py-2 rounded border border-warp-amber/40 bg-warp-amber/10">
            <div className="text-[10px] uppercase tracking-[0.18em] text-warp-amber/90 mb-1">
              Failed to load PRs
            </div>
            <div className="text-[11px] text-white/80 leading-relaxed break-words">
              {error}
            </div>
          </div>
        ) : prs.length === 0 ? (
          <div className="px-4 py-3 text-[12px] text-white/45 leading-relaxed">
            No open WARP/* PRs.
          </div>
        ) : (
          <ul className="flex flex-col">
            {prs.map((pr) => (
              <li key={pr.number} className="border-b border-hair last:border-b-0">
                {/* Mobile-first stacked row layout (designed at 375px):
                       Row 1: #number + tier + state badge + timestamp
                       Row 2: PR title (up to 2 lines, full width)
                       Row 3: branch · @author (muted)
                       Row 4: [View details] [Close ×] [Merge ✓] —
                              full-width 3-up cluster, each 1/3, so
                              nothing competes with the title for
                              horizontal space. Closed PRs collapse to
                              just View details (full width). */}
                <div className="px-3 py-2.5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-[0.14em] font-mono text-warp-blue">
                      #{pr.number}
                    </span>
                    {pr.tier && (
                      <span className="text-[9px] uppercase tracking-[0.18em] px-1.5 py-[1px] rounded border border-hair text-white/65">
                        {pr.tier}
                      </span>
                    )}
                    <span className="text-[9px] uppercase tracking-[0.18em] px-1.5 py-[1px] rounded border border-warp-blue/40 text-warp-blue bg-warp-blue-bg">
                      {pr.state}
                    </span>
                    <span className="flex-1" />
                    <span className="text-[10px] text-white/35 font-mono shrink-0">
                      {formatRelative(pr.updatedAt)}
                    </span>
                  </div>
                  <div className="text-[12px] text-white/85 leading-snug line-clamp-2">
                    {pr.title}
                  </div>
                  <div className="text-[10px] text-white/45 font-mono break-all">
                    {pr.branch} · @{pr.author}
                  </div>
                  <div className="flex items-stretch gap-1.5 mt-1">
                    <button
                      type="button"
                      onClick={() => openRow(pr.number, "detail")}
                      aria-expanded={openNumber === pr.number}
                      className="flex-1 basis-0 min-w-0 px-2 py-1.5 text-[10px] uppercase tracking-[0.14em] rounded border border-hair text-white/65 hover:text-white hover:bg-white/5 transition-colors"
                      title="View details"
                      aria-label={`View details for PR #${pr.number}`}
                    >
                      View details
                    </button>
                    {pr.state === "open" && (
                      <>
                        <button
                          type="button"
                          onClick={() => openRow(pr.number, "close")}
                          className="flex-1 basis-0 min-w-0 px-2 py-1.5 text-[10px] uppercase tracking-[0.14em] rounded border border-hair text-white/65 hover:text-warp-amber hover:border-warp-amber/40 transition-colors"
                          title="Close PR (asks for reason)"
                          aria-label={`Close PR #${pr.number}`}
                        >
                          Close ×
                        </button>
                        <button
                          type="button"
                          onClick={() => openRow(pr.number, "merge")}
                          className="flex-1 basis-0 min-w-0 px-2 py-1.5 text-[10px] uppercase tracking-[0.14em] rounded border border-warp-teal/50 bg-warp-teal-bg text-warp-teal hover:bg-warp-teal/15 transition-colors"
                          title="Merge PR (gates checked, then confirm)"
                          aria-label={`Merge PR #${pr.number}`}
                        >
                          Merge ✓
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {openNumber === pr.number && (
                  // Phase 3.5 polish — `embedded` strips the outer
                  // `my-3 rounded-md border` chrome and the WARP•CMD-
                  // badged Header from the inline `PRCard`, so the
                  // expansion reads as a continuation of THIS list row
                  // rather than a duplicate card mounted below it. A
                  // `border-t` provides the only visual divider.
                  <div className="border-t border-hair">
                    <PRCard
                      prNumber={pr.number}
                      initialIntent={openIntent}
                      sessionId={sessionId}
                      embedded
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {truncated && (
          <div className="px-4 py-2 text-[10px] text-white/35 leading-relaxed border-t border-hair">
            Showing first 30 — refine via GitHub.
          </div>
        )}
      </div>
    </div>
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
