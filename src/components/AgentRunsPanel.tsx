"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/api-fetch";

/**
 * Coding-agent monitor (admin-only tab).
 *
 * Start an autonomous run (task + optional repo/branch) and watch it execute:
 * the list shows every run with its routing decision + status; selecting one
 * opens the live transcript, polled while the run is `running`. Mirrors the
 * `ws-*` styling used by the other settings tabs.
 */

type RunStatus = "running" | "completed" | "max_steps" | "error";

type RunListItem = {
  id: string;
  task: string;
  status: RunStatus;
  difficulty: string | null;
  tier: string | null;
  model: string | null;
  provider: string | null;
  repo_url: string | null;
  branch: string | null;
  summary: string | null;
  stepCount: number;
  created_at: string;
};

type ToolExecution = { call: { name: string }; output: string; ok: boolean };
type AgentStep = { index: number; thought: string | null; executions: ToolExecution[] };

type RunDetail = Omit<RunListItem, "stepCount"> & {
  steps: AgentStep[];
  sandbox_id: string | null;
  finished_at: string | null;
};

const STATUS_COLOR: Record<RunStatus, string> = {
  running: "#6ea8fe",
  completed: "#4ade80",
  max_steps: "#fbbf24",
  error: "#f87171",
};

function StatusDot({ status }: { status: RunStatus }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: STATUS_COLOR[status],
        marginRight: 6,
        boxShadow: status === "running" ? `0 0 6px ${STATUS_COLOR.running}` : undefined,
      }}
    />
  );
}

export default function AgentRunsPanel() {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // Start form.
  const [task, setTask] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [starting, setStarting] = useState(false);

  const loadRuns = useCallback(async () => {
    try {
      const res = await authFetch("/api/agent/runs", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { runs: RunListItem[] };
      setRuns(d.runs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load runs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  // Poll the list while any run is in progress.
  useEffect(() => {
    if (!runs.some((r) => r.status === "running")) return;
    const t = setInterval(() => void loadRuns(), 3000);
    return () => clearInterval(t);
  }, [runs, loadRuns]);

  const start = async () => {
    if (!task.trim()) return;
    setStarting(true);
    setError(null);
    try {
      const res = await authFetch("/api/agent/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: task.trim(),
          repoUrl: repoUrl.trim() || undefined,
          branch: branch.trim() || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setTask("");
      setSelected(j.id ?? null);
      await loadRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to start run");
    } finally {
      setStarting(false);
    }
  };

  if (selected) {
    return <RunDetailView id={selected} onBack={() => { setSelected(null); void loadRuns(); }} />;
  }

  return (
    <div>
      <p className="ws-help">
        Run an autonomous coding task in an isolated sandbox. The model is chosen
        by task difficulty (easy→Haiku, medium→Sonnet, hard→Opus). Max 2 runs at a
        time.
      </p>

      <textarea
        className="ws-textarea"
        rows={3}
        value={task}
        placeholder="e.g. Add a /health endpoint that returns { ok: true } and a test for it."
        onChange={(e) => setTask(e.target.value)}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          className="ws-input"
          style={{ flex: 2 }}
          value={repoUrl}
          placeholder="https://github.com/owner/repo.git (optional)"
          onChange={(e) => setRepoUrl(e.target.value)}
        />
        <input
          className="ws-input"
          style={{ flex: 1 }}
          value={branch}
          placeholder="branch (optional)"
          onChange={(e) => setBranch(e.target.value)}
        />
      </div>
      <button
        type="button"
        className="cs-action"
        style={{ marginTop: 8 }}
        disabled={starting || !task.trim()}
        onClick={() => void start()}
      >
        {starting ? "Starting…" : "Start run"}
      </button>

      {error && <p className="cs-error" style={{ marginTop: 8 }}>{error}</p>}

      <div style={{ marginTop: 16 }}>
        {loading ? (
          <p className="ws-help">Loading runs…</p>
        ) : runs.length === 0 ? (
          <p className="ws-help">No runs yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {runs.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="cs-action"
                  style={{ width: "100%", textAlign: "left", marginBottom: 6 }}
                  onClick={() => setSelected(r.id)}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <StatusDot status={r.status} />
                      {r.task}
                    </span>
                    <span style={{ opacity: 0.6, fontSize: 12, flexShrink: 0, marginLeft: 8 }}>
                      {r.tier ?? "—"} · {r.stepCount} steps
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RunDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/agent/runs/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { run: RunDetail };
      setRun(d.run);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load run");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while the run is in progress.
  useEffect(() => {
    if (run && run.status !== "running") return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [run, load]);

  return (
    <div>
      <button type="button" className="cs-action" onClick={onBack} style={{ marginBottom: 12 }}>
        ← Back to runs
      </button>

      {error && <p className="cs-error">{error}</p>}
      {!run ? (
        <p className="ws-help">Loading…</p>
      ) : (
        <div>
          <div style={{ marginBottom: 8 }}>
            <strong>
              <StatusDot status={run.status} />
              {run.status}
            </strong>
            <span style={{ opacity: 0.7, marginLeft: 8, fontSize: 13 }}>
              {run.difficulty ?? "—"} → {run.tier ?? "—"} ({run.model ?? "—"}
              {run.provider ? ` · ${run.provider}` : ""})
            </span>
          </div>
          <p className="ws-help" style={{ marginTop: 0 }}>{run.task}</p>
          {run.summary && (
            <p style={{ fontSize: 13, padding: "6px 8px", background: "rgba(255,255,255,0.04)", borderRadius: 6 }}>
              {run.summary}
            </p>
          )}

          <ol style={{ paddingLeft: 18, marginTop: 12 }}>
            {run.steps.map((s) => (
              <li key={s.index} style={{ marginBottom: 10 }}>
                {s.thought && <div style={{ fontSize: 13, marginBottom: 4 }}>{s.thought}</div>}
                {s.executions.map((ex, i) => (
                  <details key={i} style={{ fontSize: 12, marginBottom: 4 }}>
                    <summary style={{ cursor: "pointer", color: ex.ok ? undefined : STATUS_COLOR.error }}>
                      {ex.ok ? "✓" : "✗"} {ex.call.name}
                    </summary>
                    <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", opacity: 0.8, margin: "4px 0", maxHeight: 200, overflow: "auto" }}>
                      {ex.output}
                    </pre>
                  </details>
                ))}
              </li>
            ))}
          </ol>
          {run.status === "running" && <p className="ws-help">Working…</p>}
        </div>
      )}
    </div>
  );
}
