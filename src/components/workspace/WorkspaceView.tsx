"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/cn";
import FileTree from "./FileTree";
import CodeEditor from "./CodeEditor";
import PreviewPane from "./PreviewPane";
import TerminalPane from "./TerminalPane";
import ViewToggle, { type AppView } from "../ViewToggle";

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

type Props = {
  onOpenDrawer?: () => void;
  isAdmin: boolean;
  view?: AppView;
  onViewChange?: (v: AppView) => void;
  /** The AI chat surface (a header-less ChatArea) embedded into the IDE. */
  chatSlot?: React.ReactNode;
};

export default function WorkspaceView({
  onOpenDrawer,
  isAdmin,
  view,
  onViewChange,
  chatSlot,
}: Props) {
  const [record, setRecord] = useState<WorkspaceRecord | null | undefined>(undefined);
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [treeKey, setTreeKey] = useState(0);
  // Which surface is showing. On desktop the explorer + editor are always
  // visible and this only drives the right panel (AI/Preview/Terminal). On
  // mobile it's the single visible pane, switched via the top tab bar.
  const [pane, setPane] = useState<
    "files" | "editor" | "ai" | "preview" | "terminal"
  >("ai");
  // The right panel only ever shows ai/preview/terminal; files/editor are
  // mobile-only panes, so fall back to the chat there.
  const activeRight = pane === "preview" || pane === "terminal" ? pane : "ai";

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
        view={view}
        onViewChange={onViewChange}
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
        // No live sandbox yet — still give Code view a usable chatbox. The
        // header carries the create/resume controls; the body is the AI chat.
        <div className="flex-1 min-h-0 flex flex-col">
          {chatSlot ?? <EmptyWorkspace status={record?.status} isAdmin={isAdmin} />}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {/* Mobile tab bar — single-column IDE on phones. Hidden on desktop,
              where explorer + editor + right panel sit side by side. */}
          <div className="md:hidden flex items-center gap-1 px-2 py-1 border-b border-hair text-xs overflow-x-auto">
            <TabButton active={pane === "files"} onClick={() => setPane("files")}>
              Files
            </TabButton>
            <TabButton active={pane === "editor"} onClick={() => setPane("editor")}>
              Editor
            </TabButton>
            {chatSlot && (
              <TabButton active={pane === "ai"} onClick={() => setPane("ai")}>
                AI
              </TabButton>
            )}
            <TabButton active={pane === "preview"} onClick={() => setPane("preview")}>
              Preview
            </TabButton>
            <TabButton active={pane === "terminal"} onClick={() => setPane("terminal")}>
              Terminal
            </TabButton>
          </div>

          {/* Explorer — mobile: only when "files" pane is active; desktop: fixed column. */}
          <div
            className={cn(
              "overflow-auto md:!flex md:flex-col md:w-60 md:flex-none md:border-r md:border-hair",
              pane === "files" ? "flex flex-1 min-h-0 flex-col" : "hidden",
            )}
          >
            <div className="px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-white/35">
              Explorer
            </div>
            <FileTree activePath={activeFile} refreshKey={treeKey} onOpenFile={setActiveFile} />
          </div>
          {/* Editor — mobile: only when "editor" pane; desktop: flexes to fill. */}
          <div
            className={cn(
              "min-w-0 md:!flex md:flex-1 md:flex-col md:border-r md:border-hair",
              pane === "editor" ? "flex flex-1 min-h-0 flex-col" : "hidden",
            )}
          >
            <CodeEditor path={activeFile} onSaved={() => setTreeKey((k) => k + 1)} />
          </div>
          {/* AI / Preview / Terminal — mobile: when one of those panes; desktop: fixed right column. */}
          <div
            className={cn(
              "min-h-0 md:!flex md:flex-col md:w-[42%] md:min-w-[320px] md:flex-none md:border-l md:border-hair",
              pane === "ai" || pane === "preview" || pane === "terminal"
                ? "flex flex-1 flex-col"
                : "hidden",
            )}
          >
            {/* Desktop sub-tabs — mobile uses the top bar instead. */}
            <div className="hidden md:flex items-center gap-1 px-2 py-1 border-b border-hair text-xs">
              {chatSlot && (
                <TabButton active={activeRight === "ai"} onClick={() => setPane("ai")}>
                  AI
                </TabButton>
              )}
              <TabButton active={activeRight === "preview"} onClick={() => setPane("preview")}>
                Preview
              </TabButton>
              <TabButton active={activeRight === "terminal"} onClick={() => setPane("terminal")}>
                Terminal
              </TabButton>
            </div>
            <div className="flex-1 min-h-0">
              {/* Keep the chat mounted across tab switches so its transcript +
                  stream survive; just toggle visibility. */}
              {chatSlot && (
                <div className={cn("h-full", activeRight === "ai" ? "flex flex-col" : "hidden")}>
                  {chatSlot}
                </div>
              )}
              {activeRight === "preview" && <PreviewPane />}
              {activeRight === "terminal" && (
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
  view,
  onViewChange,
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
  view?: AppView;
  onViewChange?: (v: AppView) => void;
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
      {view && onViewChange && <ViewToggle view={view} onChange={onViewChange} />}
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
