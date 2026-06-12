"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/cn";

/**
 * Lazy file-tree explorer for the IDE.
 *
 * Each directory fetches its children only when first expanded
 * (GET /api/workspace/files?path=…), so a large repo doesn't load all at once.
 * Selecting a file calls `onOpenFile` with its workspace-relative path; the
 * parent opens it in the editor.
 */

type Entry = { name: string; isDir: boolean; path: string };

type Props = {
  /** Currently-open file path (highlighted). */
  activePath: string | null;
  /** Bumped by the parent to force a refetch (e.g. after a terminal command). */
  refreshKey?: number;
  onOpenFile: (path: string) => void;
};

export default function FileTree({ activePath, refreshKey, onOpenFile }: Props) {
  return (
    <div className="text-[13px] leading-5 py-1">
      <TreeLevel
        dirPath=""
        depth={0}
        activePath={activePath}
        refreshKey={refreshKey}
        onOpenFile={onOpenFile}
      />
    </div>
  );
}

function TreeLevel({
  dirPath,
  depth,
  activePath,
  refreshKey,
  onOpenFile,
}: {
  dirPath: string;
  depth: number;
  activePath: string | null;
  refreshKey?: number;
  onOpenFile: (path: string) => void;
}) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ path: dirPath });
      const res = await authFetch(`/api/workspace/files?${qs.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as { entries?: Entry[]; error?: string };
      if (!res.ok) {
        setError(json.error || `Failed (${res.status})`);
        setEntries([]);
        return;
      }
      setEntries(json.entries ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [dirPath]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loading && !entries) {
    return <Indented depth={depth}><span className="text-white/35">Loading…</span></Indented>;
  }
  if (error) {
    return <Indented depth={depth}><span className="text-red-300/80">{error}</span></Indented>;
  }
  if (entries && entries.length === 0) {
    return <Indented depth={depth}><span className="text-white/30">empty</span></Indented>;
  }
  return (
    <ul className="m-0 p-0 list-none">
      {entries?.map((e) =>
        e.isDir ? (
          <DirNode
            key={e.path}
            entry={e}
            depth={depth}
            activePath={activePath}
            refreshKey={refreshKey}
            onOpenFile={onOpenFile}
          />
        ) : (
          <FileNode
            key={e.path}
            entry={e}
            depth={depth}
            active={activePath === e.path}
            onOpenFile={onOpenFile}
          />
        ),
      )}
    </ul>
  );
}

function DirNode({
  entry,
  depth,
  activePath,
  refreshKey,
  onOpenFile,
}: {
  entry: Entry;
  depth: number;
  activePath: string | null;
  refreshKey?: number;
  onOpenFile: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left flex items-center gap-1 py-0.5 hover:bg-white/5 rounded"
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        <span className="text-white/40 w-3 inline-block">{open ? "▾" : "▸"}</span>
        <span className="text-white/80">{entry.name}</span>
      </button>
      {open && (
        <TreeLevel
          dirPath={entry.path}
          depth={depth + 1}
          activePath={activePath}
          refreshKey={refreshKey}
          onOpenFile={onOpenFile}
        />
      )}
    </li>
  );
}

function FileNode({
  entry,
  depth,
  active,
  onOpenFile,
}: {
  entry: Entry;
  depth: number;
  active: boolean;
  onOpenFile: (path: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpenFile(entry.path)}
        className={cn(
          "w-full text-left flex items-center gap-1 py-0.5 rounded hover:bg-white/5",
          active && "bg-white/10",
        )}
        style={{ paddingLeft: depth * 12 + 24 }}
      >
        <span className={cn("truncate", active ? "text-white" : "text-white/65")}>
          {entry.name}
        </span>
      </button>
    </li>
  );
}

function Indented({ depth, children }: { depth: number; children: React.ReactNode }) {
  return (
    <div className="py-0.5" style={{ paddingLeft: depth * 12 + 24 }}>
      {children}
    </div>
  );
}
