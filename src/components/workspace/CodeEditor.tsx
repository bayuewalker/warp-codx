"use client";

import { useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/cn";

/**
 * Minimal, dependency-free code editor for the IDE.
 *
 * Loads a file on open (GET /api/workspace/file), tracks unsaved edits, and
 * saves on ⌘/Ctrl-S or the Save button (PUT /api/workspace/file). A plain
 * monospace textarea (with Tab-inserts-spaces) keeps the bundle lean and the
 * behavior fully predictable — no heavy editor dependency to verify.
 */

type Props = {
  /** Workspace-relative path, or null for the empty state. */
  path: string | null;
  /** Notify the parent a save succeeded (e.g. to refresh the tree). */
  onSaved?: (path: string) => void;
};

export default function CodeEditor({ path, onSaved }: Props) {
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const dirty = content !== original;

  useEffect(() => {
    if (!path) {
      setContent("");
      setOriginal("");
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const qs = new URLSearchParams({ path });
        const res = await authFetch(`/api/workspace/file?${qs.toString()}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as { content?: string; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || `Failed to open (${res.status})`);
          setContent("");
          setOriginal("");
          return;
        }
        setContent(json.content ?? "");
        setOriginal(json.content ?? "");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Network error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  async function save() {
    if (!path || saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch("/api/workspace/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error || `Save failed (${res.status})`);
        return;
      }
      setOriginal(content);
      onSaved?.(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart: s, selectionEnd: en } = ta;
      const next = `${content.slice(0, s)}  ${content.slice(en)}`;
      setContent(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = s + 2;
      });
    }
  }

  if (!path) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/30 text-sm">
        Select a file to edit
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-hair text-xs">
        <span className="text-white/70 truncate">{path}</span>
        {dirty && <span className="text-amber-300/80">● unsaved</span>}
        <div className="ml-auto flex items-center gap-2">
          {error && <span className="text-red-300/80 truncate max-w-[40ch]">{error}</span>}
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            className={cn(
              "px-2 py-0.5 rounded border border-hair",
              dirty && !saving
                ? "text-white hover:bg-white/10"
                : "text-white/30 cursor-default",
            )}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <textarea
        ref={taRef}
        value={loading ? "" : content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        placeholder={loading ? "Loading…" : ""}
        className="flex-1 min-h-0 w-full resize-none bg-transparent text-white/90 px-3 py-2 outline-none font-mono text-[13px] leading-5"
        style={{ tabSize: 2 }}
      />
    </div>
  );
}
