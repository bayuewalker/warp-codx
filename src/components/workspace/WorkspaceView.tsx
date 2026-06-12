"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/cn";
import FileTree from "./FileTree";
import CodeEditor from "./CodeEditor";
import PreviewPane from "./PreviewPane";
import TerminalPane from "./TerminalPane";

/**
 * The Replit-style IDE surface.
 *
 * Composes the four panes over a persistent per-user workspace: a file-tree
 * explorer, a code editor, and a right column that toggles between the live
 * preview (webview) and a terminal. The header drives the workspace lifecycle
 * (create/resume on a repo, stop) and reflects its status.
 */

type WorkspaceStatus = "creating" | "running" | "stopped" | "error";
type WorkspaceRecord = {
  sandbox_id: string | null;
  repo_url: string | null;
  branch: string | null;
  status: WorkspaceStatus;
};

type Props = { onOpenDrawer?: () => void; isAdmin: boolean };

export default function WorkspaceView({ onOpenDrawer, isAdmin }: Props) {
  const [record, setRecord] = useState<WorkspaceRecord | null | undefined>(undefined);
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [treeKey, setTreeKey] = useState(0);
  const [rightTab, setRightTab] = useState<"preview" | "terminal">("terminal");

  const refreshStatus = useCallback(async () => {
    try {
      const res = await authFetch("/api/workspace", { cache: "no-store" });
      const json = (await res.json()) as { workspace?: WorkspaceRecord | null };
      setRecord(json.workspace ?? null);
      if (json.workspace?.repo_url) setRepoUrl((v) => v || json.workspace!.repo_url!);
    } catch {
      setRecord(null);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const live = record?.status === "running" && !!record?.sandbox_id;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: repoUrl.trim() || undefined,
          branch: branch.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { workspace?: WorkspaceRecord; error?: string };
      if (!res.ok) {
        setError(json.error || `Failed (${res.status})`);
        return;
      }
      setRecord(json.workspace ?? null);
      setTreeKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      await authFetch("/api/workspace/stop", { method: "POST" });
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Header
        record={record}
        repoUrl={repoUrl}
        branch={branch}
        busy={busy}
        live={live}
        isAdmin={isAdmin}
        onRepoUrl={setRepoUrl}
        onBranch={setBranch}
        onStart={start}
        onStop={stop}
        onOpenDrawer={onOpenDrawer}
      />
      {error && (
        <div className="px-4 py-1.5 text-xs text-red-300/85 border-b border-hair">{error}</div>
      )}

      {!live ? (
        <EmptyWorkspace status={record?.status} isAdmin={isAdmin} />
      ) : (
        <div className="flex-1 min-h-0 flex">
          {/* Explorer */}
          <div className="w-60 shrink-0 border-r border-hair overflow-auto">
            <div className="px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-white/35">
              Explorer
            </div>
            <FileTree activePath={activeFile} refreshKey={treeKey} onOpenFile={setActiveFile} />
          </div>
          {/* Editor */}
          <div className="flex-1 min-w-0 flex flex-col border-r border-hair">
            <CodeEditor path={activeFile} onSaved={() => setTreeKey((k) => k + 1)} />
          </div>
          {/* Preview / Terminal */}
          <div className="w-[42%] min-w-[320px] flex flex-col">
            <div className="flex items-center gap-1 px-2 py-1 border-b border-hair text-xs">
              <TabButton active={rightTab === "preview"} onClick={() => setRightTab("preview")}>
                Preview
              </TabButton>
              <TabButton active={rightTab === "terminal"} onClick={() => setRightTab("terminal")}>
                Terminal
              </TabButton>
            </div>
            <div className="flex-1 min-h-0">
              {rightTab === "preview" ? (
                <PreviewPane />
              ) : (
                <TerminalPane onAfterCommand={() => setTreeKey((k) => k + 1)} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Header({
  record,
  repoUrl,
  branch,
  busy,
  live,
  isAdmin,
  onRepoUrl,
  onBranch,
  onStart,
  onStop,
  onOpenDrawer,
}: {
  record: WorkspaceRecord | null | undefined;
  repoUrl: string;
  branch: string;
  busy: boolean;
  live: boolean;
  isAdmin: boolean;
  onRepoUrl: (v: string) => void;
  onBranch: (v: string) => void;
  onStart: () => void;
  onStop: () => void;
  onOpenDrawer?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-hair">
      {onOpenDrawer && (
        <button
          type="button"
          onClick={onOpenDrawer}
          className="md:hidden px-2 py-1 rounded border border-hair text-white/70"
          aria-label="Open menu"
        >
          ☰
        </button>
      )}
      <span className="text-sm text-white/80 font-medium">Workspace</span>
      <StatusBadge status={record?.status} live={live} />
      <div className="ml-auto flex items-center gap-2 text-xs">
        {!live && (
          <>
            <input
              value={repoUrl}
              onChange={(e) => onRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo (optional)"
              spellCheck={false}
              className="bg-white/5 rounded px-2 py-1 text-white/85 outline-none w-64"
            />
            <input
              value={branch}
              onChange={(e) => onBranch(e.target.value)}
              placeholder="branch"
              spellCheck={false}
              className="bg-white/5 rounded px-2 py-1 text-white/85 outline-none w-24"
            />
          </>
        )}
        {live ? (
          <button
            type="button"
            onClick={onStop}
            disabled={busy}
            className="px-3 py-1 rounded border border-hair text-white/80 hover:bg-white/10"
          >
            {busy ? "…" : "Stop"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onStart}
            disabled={busy || !isAdmin}
            title={isAdmin ? undefined : "Workspaces are admin-only for now."}
            className={cn(
              "px-3 py-1 rounded border border-hair",
              busy || !isAdmin ? "text-white/30" : "text-white hover:bg-white/10",
            )}
          >
            {busy ? "Starting…" : record?.sandbox_id ? "Resume" : "Create workspace"}
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyWorkspace({ status, isAdmin }: { status?: WorkspaceStatus; isAdmin: boolean }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-sm px-6">
        <div className="text-white/70 text-sm mb-2">
          {status === "creating"
            ? "Spinning up your sandbox…"
            : status === "error"
              ? "The workspace hit an error."
              : status === "stopped"
                ? "Workspace is stopped."
                : "No workspace yet."}
        </div>
        <p className="text-white/40 text-xs leading-5">
          {isAdmin
            ? "Optionally paste a GitHub repo URL above, then create a persistent sandbox with a file tree, editor, terminal, and live preview."
            : "Coding workspaces are available to admins for now."}
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ status, live }: { status?: WorkspaceStatus; live: boolean }) {
  const color = live
    ? "#4ade80"
    : status === "creating"
      ? "#fbbf24"
      : status === "error"
        ? "#f87171"
        : "#6b7280";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-white/50">
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ background: color, boxShadow: live ? `0 0 6px ${color}` : undefined }}
      />
      {live ? "running" : status ?? "none"}
    </span>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 rounded",
        active ? "bg-white/10 text-white" : "text-white/55 hover:text-white/80",
      )}
    >
      {children}
    </button>
  );
}
