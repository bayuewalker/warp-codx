"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type FileSummary = {
  path: string;
  cached: boolean;
  ageMs: number | null;
  sizeBytes: number | null;
  lastStatus: string | null;
  lastFetchedAt: string | null;
  lastError: string | null;
};

type StatusPayload = {
  state: "synced" | "stale" | "offline";
  projectRoot: string;
  ttlMs: number;
  files: FileSummary[];
  checkedAt: string;
};

type BadgeState = "synced" | "refreshing" | "stale" | "offline";

const POLL_MS = 30_000;

/**
 * Header status badge (Phase 3a). Small monochrome dot + text. Polls
 * /api/constitution/status every 30s; tap opens a bottom sheet with
 * per-file ages and a Refresh button.
 *
 * Visually conforms to the existing v2 header chrome — no new colors,
 * no new typography. Greens/ambers/reds reuse the v2 LED palette
 * (--warp-teal / --warp-amber / --warp-red).
 */
export default function ConstitutionBadge() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/constitution/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as StatusPayload;
      if (!aliveRef.current) return;
      setStatus(json);
      setError(null);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err instanceof Error ? err.message : "status_failed");
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(t);
    };
  }, [load]);

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/constitution/refresh", { method: "POST" });
    } finally {
      await load();
      setRefreshing(false);
    }
  };

  const state: BadgeState = refreshing
    ? "refreshing"
    : error
      ? "offline"
      : (status?.state ?? "offline");

  const label =
    state === "synced"
      ? "synced"
      : state === "refreshing"
        ? "refreshing"
        : state === "stale"
          ? "stale"
          : "offline";

  return (
    <>
      <button
        type="button"
        className="constitution-badge"
        data-state={state}
        onClick={() => setOpen(true)}
        title={`Constitution: ${label}`}
        aria-label={`Constitution status: ${label}. Tap for details.`}
      >
        <span className="constitution-badge-dot" aria-hidden="true" />
        <span className="constitution-badge-text">CONST · {label}</span>
      </button>

      {open && (
        <BottomSheet onClose={() => setOpen(false)}>
          <div className="cb-sheet-header">
            <div>
              <div className="cb-sheet-title">Constitution</div>
              <div className="cb-sheet-sub">
                {status?.projectRoot ?? "—"}
              </div>
            </div>
            <button
              type="button"
              className="cb-refresh-btn"
              onClick={doRefresh}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing…" : "Refresh now"}
            </button>
          </div>

          {error && (
            <div className="cb-error">Status check failed: {error}</div>
          )}

          <ul className="cb-file-list">
            {(status?.files ?? []).map((f) => (
              <li key={f.path} className="cb-file-row">
                <div className="cb-file-row-top">
                  <span className="cb-file-path">{f.path}</span>
                  <FileStateChip f={f} />
                </div>
                <div className="cb-file-row-meta">
                  {f.cached
                    ? `${formatAge(f.ageMs)} · ${formatBytes(f.sizeBytes)}`
                    : "no cache"}
                  {f.lastError && (
                    <>
                      {" · "}
                      <span className="cb-file-err">{truncate(f.lastError, 60)}</span>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </BottomSheet>
      )}
    </>
  );
}

function FileStateChip({ f }: { f: FileSummary }) {
  const fresh =
    f.cached && typeof f.ageMs === "number" && f.ageMs < 5 * 60 * 1000;
  const tone =
    f.lastStatus === "error_fallback"
      ? "stale"
      : fresh
        ? "synced"
        : f.cached
          ? "old"
          : "offline";
  const label =
    tone === "synced"
      ? "fresh"
      : tone === "old"
        ? "old"
        : tone === "stale"
          ? "stale"
          : "offline";
  return (
    <span className="cb-file-chip" data-tone={tone}>
      {label}
    </span>
  );
}

function BottomSheet({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="cb-sheet-root" role="dialog" aria-modal="true">
      <div className="cb-sheet-backdrop" onClick={onClose} />
      <div className="cb-sheet">
        <div className="cb-sheet-grip" />
        {children}
      </div>
    </div>
  );
}

function formatAge(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function formatBytes(b: number | null): string {
  if (b == null) return "—";
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 / 1024).toFixed(2)}MB`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
