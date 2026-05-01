"use client";

import { useCallback, useEffect, useState } from "react";
import { PRS_ADMIN_TOKEN_STATUS_EVENT } from "@/lib/prs-fetch";
import { ISSUES_ADMIN_TOKEN_STATUS_EVENT } from "@/lib/issues-fetch";
import {
  ADMIN_TOKEN_EVENT,
  clearAllAdminTokens,
  hasAnyAdminToken,
  setAllAdminTokens,
} from "@/lib/admin-token";
import PushNotificationToggle from "@/components/PushNotificationToggle";

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

type PatTest = {
  ok: boolean;
  status: string;
  detail: string;
  repo: string;
  checkedAt?: string;
};

/**
 * Constitution settings panel. Shows repo, PAT scope, active project,
 * Tier 1 files, cache totals, and three actions: REFRESH ALL,
 * CLEAR CACHE, TEST PAT.
 */
export default function ConstitutionSettings({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [busy, setBusy] = useState<"refresh" | "clear" | "test" | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [lastClear, setLastClear] = useState<{ cleared: number; at: string } | null>(null);
  const [patResult, setPatResult] = useState<PatTest | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Task #25 — admin-token control for the PRs / Issues panels.
  const [tokenSet, setTokenSet] = useState<boolean>(false);
  const [tokenFlash, setTokenFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/constitution/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as StatusPayload;
      setStatus(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "status_failed");
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Re-read whether either admin token is cached whenever the modal
  // opens, and whenever any other surface emits a change event.
  useEffect(() => {
    if (!open) return;
    const sync = () => {
      setTokenSet(hasAnyAdminToken());
    };
    sync();
    if (typeof window === "undefined") return;
    // Combined event covers explicit Settings actions; per-key status
    // events cover the 403 auto-retry write case so the badge reflects
    // reality even when the operator answers a prompt while open.
    window.addEventListener(ADMIN_TOKEN_EVENT, sync);
    window.addEventListener(PRS_ADMIN_TOKEN_STATUS_EVENT, sync);
    window.addEventListener(ISSUES_ADMIN_TOKEN_STATUS_EVENT, sync);
    return () => {
      window.removeEventListener(ADMIN_TOKEN_EVENT, sync);
      window.removeEventListener(PRS_ADMIN_TOKEN_STATUS_EVENT, sync);
      window.removeEventListener(ISSUES_ADMIN_TOKEN_STATUS_EVENT, sync);
    };
  }, [open]);

  const onSetAdminToken = () => {
    if (typeof window === "undefined") return;
    const raw = window.prompt(
      "Enter WARP_ADMIN_TOKEN (used for PRs + Issues panels). Leave blank to cancel.",
    );
    const trimmed = raw ? raw.trim() : "";
    if (!trimmed) return;
    setAllAdminTokens(trimmed);
    setTokenFlash("Admin token saved for this browser tab.");
  };

  const onClearAdminToken = () => {
    clearAllAdminTokens();
    setTokenFlash("Admin token cleared from this browser tab.");
  };

  const onRefreshAll = async () => {
    setBusy("refresh");
    try {
      const res = await fetch("/api/constitution/refresh", { method: "POST" });
      if (res.ok) setLastRefreshAt(new Date().toISOString());
    } finally {
      await load();
      setBusy(null);
    }
  };

  const onClear = async () => {
    setBusy("clear");
    try {
      const res = await fetch("/api/constitution/clear", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as {
        cleared?: number;
        error?: string;
      };
      if (res.ok) {
        setLastClear({ cleared: json.cleared ?? 0, at: new Date().toISOString() });
      } else {
        setError(json.error ?? `Clear failed (HTTP ${res.status})`);
      }
    } finally {
      await load();
      setBusy(null);
    }
  };

  const onTestPat = async () => {
    setBusy("test");
    setPatResult(null);
    try {
      const res = await fetch("/api/constitution/test-pat", { cache: "no-store" });
      const json = (await res.json()) as PatTest;
      setPatResult(json);
    } catch (err) {
      setPatResult({
        ok: false,
        status: "fetch_failed",
        detail: err instanceof Error ? err.message : "fetch_failed",
        repo: "—",
      });
    } finally {
      setBusy(null);
    }
  };

  if (!open) return null;

  const cacheCount = (status?.files ?? []).filter((f) => f.cached).length;
  const cacheBytes = (status?.files ?? []).reduce(
    (acc, f) => acc + (f.sizeBytes ?? 0),
    0,
  );

  return (
    <div className="cs-root" role="dialog" aria-modal="true" aria-label="Constitution settings">
      <div className="cs-backdrop" onClick={onClose} />
      <div className="cs-modal">
        <div className="cs-header">
          <div>
            <div className="cs-eyebrow">Phase 3a</div>
            <div className="cs-title">Constitution</div>
          </div>
          <button
            type="button"
            className="cs-close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ×
          </button>
        </div>

        <div className="cs-grid">
          <Field label="Repo" value="bayuewalker/walkermind-os" mono />
          <Field label="PAT scope" value="contents:read · fine-grained" mono />
          <Field label="Active project" value={status?.projectRoot ?? "—"} mono />
          <Field
            label="PROJECT_ROOT"
            value={status?.projectRoot ?? "—"}
            mono
          />
          <Field
            label="Cache TTL"
            value={status ? `${Math.round(status.ttlMs / 60000)} min` : "—"}
          />
          <Field
            label="Cached files"
            value={`${cacheCount} (${formatBytes(cacheBytes)})`}
          />
          <Field
            label="Last refresh"
            value={lastRefreshAt ? formatTime(lastRefreshAt) : "—"}
          />
          <Field
            label="Overall state"
            value={status?.state ?? "unknown"}
            mono
          />
        </div>

        <div className="cs-section-title">Tier 1 files</div>
        <ul className="cs-files">
          {(status?.files ?? []).map((f) => (
            <li key={f.path} className="cs-file">
              <span className="cs-file-path">{f.path}</span>
              <span className="cs-file-meta">
                {f.cached
                  ? `${formatAge(f.ageMs)} · ${formatBytes(f.sizeBytes)}`
                  : "no cache"}
                {f.lastError ? ` · ${truncate(f.lastError, 50)}` : ""}
              </span>
            </li>
          ))}
        </ul>

        {patResult && (
          <div className="cs-pat" data-ok={patResult.ok ? "true" : "false"}>
            <div className="cs-pat-label">PAT test</div>
            <div className="cs-pat-detail">
              {patResult.ok ? "OK" : patResult.status} · {patResult.detail}
            </div>
          </div>
        )}

        {lastClear && (
          <div className="cs-flash">
            Cleared {lastClear.cleared} cache row(s) at {formatTime(lastClear.at)}.
          </div>
        )}

        {error && <div className="cs-error">{error}</div>}

        <div className="cs-section-title">Admin token</div>
        <div className="cs-pat" data-ok={tokenSet ? "true" : "false"}>
          <div className="cs-pat-label">
            {tokenSet ? "Token set" : "Token not set"}
          </div>
          <div className="cs-pat-detail">
            {tokenSet
              ? "PRs + Issues panels can call admin endpoints from this browser tab."
              : "Set WARP_ADMIN_TOKEN to load Pull Requests and create Issues without hitting a 403 prompt."}
          </div>
        </div>
        {tokenFlash && <div className="cs-flash">{tokenFlash}</div>}
        <div className="cs-actions" style={{ marginBottom: 10 }}>
          <button
            type="button"
            className="cs-action"
            onClick={onSetAdminToken}
          >
            {tokenSet ? "REPLACE TOKEN" : "SET TOKEN"}
          </button>
          <button
            type="button"
            className="cs-action"
            onClick={onClearAdminToken}
            disabled={!tokenSet}
          >
            CLEAR TOKEN
          </button>
        </div>

        <div className="cs-actions" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className="cs-action"
            onClick={onRefreshAll}
            disabled={busy !== null}
          >
            {busy === "refresh" ? "Refreshing…" : "REFRESH ALL"}
          </button>
          <button
            type="button"
            className="cs-action"
            onClick={onClear}
            disabled={busy !== null}
          >
            {busy === "clear" ? "Clearing…" : "CLEAR CACHE"}
          </button>
          <button
            type="button"
            className="cs-action"
            onClick={onTestPat}
            disabled={busy !== null}
          >
            {busy === "test" ? "Testing…" : "TEST PAT"}
          </button>
        </div>

        {/* Phase 4 — push notifications opt-in. Self-contained:
            owns its own state, permission flow, and SW registration. */}
        <PushNotificationToggle />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="cs-field">
      <div className="cs-field-label">{label}</div>
      <div className={mono ? "cs-field-value warp-mono" : "cs-field-value"}>
        {value}
      </div>
    </div>
  );
}

function formatAge(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}
function formatBytes(b: number | null): string {
  if (b == null) return "—";
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 / 1024).toFixed(2)}MB`;
}
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
