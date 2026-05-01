"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { adminFetch } from "@/lib/admin-fetch";
import { summarizeRefresh, type RefreshBody } from "@/lib/refresh-summary";

type FileStatus = {
  path: string;
  ageMs: number | null;
  sizeBytes: number | null;
  lastStatus:
    | "hit_cache"
    | "miss_fetch"
    | "error_fallback"
    | "missing"
    | null;
  withinTtl: boolean;
};

type StatusPayload = {
  overall: "synced" | "stale" | "offline" | "warming";
  repo: string;
  projectRoot: string;
  ttlMs: number;
  files: FileStatus[];
  cacheCount: number;
  totalCacheBytes: number;
  asOf: string;
};

type RefreshState = "idle" | "refreshing" | "ok" | "err";

const POLL_INTERVAL_MS = 30_000;

/**
 * Constitution status badge — mounted on the right side of the
 * SessionBar. Tap to open a bottom sheet with per-file detail and
 * a "Refresh now" action.
 *
 * Style is intentionally minimal: a small dot + 4-char text label
 * matching the SessionBar chrome (12px, monochrome). No layout
 * shift in the rest of the page.
 */
export default function ConstitutionStatus() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [open, setOpen] = useState(false);
  const [refresh, setRefresh] = useState<RefreshState>("idle");
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/constitution/status", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as StatusPayload;
      setData(json);
    } catch {
      /* badge silently keeps last-known state */
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus]);

  const handleRefresh = useCallback(async () => {
    setRefresh("refreshing");
    setRefreshError(null);
    try {
      const res = await adminFetch("/api/constitution/refresh", {
        method: "POST",
      });
      const json = (await res
        .json()
        .catch(() => null)) as RefreshBody | null;
      const summary = summarizeRefresh(res, json);
      await fetchStatus();
      if (summary.ok) {
        setRefresh("ok");
      } else {
        setRefresh("err");
        setRefreshError(summary.message);
      }
      setTimeout(() => {
        setRefresh("idle");
        setRefreshError(null);
      }, 4000);
    } catch (err) {
      setRefresh("err");
      setRefreshError(err instanceof Error ? err.message : "network error");
      setTimeout(() => {
        setRefresh("idle");
        setRefreshError(null);
      }, 4000);
    }
  }, [fetchStatus]);

  const overall = data?.overall ?? "warming";
  const oldest: number | null = data
    ? data.files.reduce<number | null>((acc, f) => {
        if (f.ageMs === null) return acc;
        if (acc === null) return f.ageMs;
        return Math.max(acc, f.ageMs);
      }, null)
    : null;
  const ageLabel = formatAge(oldest);

  const dotClass =
    refresh === "refreshing"
      ? "ccc-dot ccc-dot-refresh"
      : overall === "synced"
        ? "ccc-dot ccc-dot-ok"
        : overall === "stale"
          ? "ccc-dot ccc-dot-warn"
          : overall === "offline"
            ? "ccc-dot ccc-dot-err"
            : "ccc-dot ccc-dot-idle";

  const glyph =
    refresh === "refreshing"
      ? "↻"
      : overall === "synced"
        ? "✓"
        : overall === "stale"
          ? "⚠"
          : overall === "offline"
            ? "×"
            : "·";

  const text =
    refresh === "refreshing"
      ? "sync"
      : overall === "warming"
        ? "—"
        : ageLabel ?? "—";

  return (
    <>
      <button
        type="button"
        className="ccc-badge"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="Constitution status"
        aria-label={`Constitution status: ${overall}, ${text}`}
      >
        <span className={dotClass} aria-hidden="true">
          {glyph}
        </span>
        <span className="ccc-badge-text">{text}</span>
      </button>

      {open && (
        <ConstitutionSheet
          data={data}
          refresh={refresh}
          refreshError={refreshError}
          onClose={() => setOpen(false)}
          onRefresh={handleRefresh}
        />
      )}
    </>
  );
}

function ConstitutionSheet({
  data,
  refresh,
  refreshError,
  onClose,
  onRefresh,
}: {
  data: StatusPayload | null;
  refresh: RefreshState;
  refreshError: string | null;
  onClose: () => void;
  onRefresh: () => void;
}) {
  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="ccc-sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Constitution status detail"
      onClick={onClose}
    >
      <div
        className="ccc-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ccc-sheet-grip" aria-hidden="true" />
        <div className="ccc-sheet-header">
          <span className="ccc-sheet-title">CONSTITUTION STATUS</span>
          <button
            type="button"
            className="ccc-sheet-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {!data ? (
          <div className="ccc-sheet-loading">Loading…</div>
        ) : (
          <>
            <div className="ccc-sheet-meta">
              <div>
                <span className="ccc-meta-k">Repo</span>
                <span className="ccc-meta-v">{data.repo}</span>
              </div>
              <div>
                <span className="ccc-meta-k">Project</span>
                <span className="ccc-meta-v">{data.projectRoot}</span>
              </div>
              <div>
                <span className="ccc-meta-k">TTL</span>
                <span className="ccc-meta-v">
                  {Math.round(data.ttlMs / 60_000)} min
                </span>
              </div>
            </div>

            <ul className="ccc-files">
              {data.files.map((f) => (
                <li key={f.path} className="ccc-file-row">
                  <span
                    className={cn(
                      "ccc-file-glyph",
                      f.lastStatus === "error_fallback" || f.lastStatus === "missing"
                        ? "ccc-file-warn"
                        : f.withinTtl
                          ? "ccc-file-ok"
                          : "ccc-file-stale",
                    )}
                    aria-hidden="true"
                  >
                    {f.lastStatus === "error_fallback" ||
                    f.lastStatus === "missing"
                      ? "⚠"
                      : "✓"}
                  </span>
                  <span className="ccc-file-path">{shortPath(f.path)}</span>
                  <span className="ccc-file-age">
                    {f.ageMs !== null ? formatAge(f.ageMs) : "—"}
                  </span>
                  <span className="ccc-file-size">
                    {f.sizeBytes !== null ? formatBytes(f.sizeBytes) : "—"}
                  </span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              className="ccc-refresh-btn"
              onClick={onRefresh}
              disabled={refresh === "refreshing"}
            >
              {refresh === "refreshing"
                ? "Refreshing…"
                : refresh === "ok"
                  ? "Refreshed"
                  : refresh === "err"
                    ? "Refresh failed"
                    : "Refresh now"}
            </button>
            {refresh === "err" && refreshError && (
              <p className="ccc-refresh-err" role="alert">
                {refreshError}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function formatAge(ms: number | null): string | null {
  if (ms === null) return null;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  return `${hr}h`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 100) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${Math.round(bytes / 1024)}KB`;
}

function shortPath(path: string): string {
  // Trim leading project root for display.
  if (path.includes("state/PROJECT_STATE.md")) return "PROJECT_STATE.md";
  if (path.includes("state/ROADMAP.md")) return "ROADMAP.md";
  if (path.includes("state/WORKTODO.md")) return "WORKTODO.md";
  if (path.includes("state/CHANGELOG.md")) return "CHANGELOG.md";
  return path;
}
