"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/cn";

/**
 * The webview: start the project's dev server and embed its public preview URL.
 *
 * POST /api/workspace/preview launches the server detached and returns the URL
 * that proxies its port; GET restores the last-known URL on mount. The iframe
 * key is bumped to force a hard reload after (re)starting.
 */

type Props = { defaultCommand?: string; defaultPort?: number };

export default function PreviewPane({
  defaultCommand = "npm run dev",
  defaultPort = 3000,
}: Props) {
  const [command, setCommand] = useState(defaultCommand);
  const [port, setPort] = useState(defaultPort);
  const [url, setUrl] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Restore the last preview URL (e.g. after a page reload) without relaunching.
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/api/workspace/preview", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { url?: string | null; port?: number | null };
        if (json.url) setUrl(json.url);
        if (json.port) setPort(json.port);
      } catch {
        /* no preview yet */
      }
    })();
  }, []);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const res = await authFetch("/api/workspace/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, port }),
      });
      const json = (await res.json()) as { url?: string | null; error?: string };
      if (!res.ok) {
        setError(json.error || `Failed (${res.status})`);
        return;
      }
      if (json.url) {
        setUrl(json.url);
        // Give the dev server a moment to bind before the first load.
        setTimeout(() => setReloadKey((k) => k + 1), 1500);
      } else {
        setError("Server started, but no preview URL was returned by the backend.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-hair text-xs">
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          spellCheck={false}
          className="bg-white/5 rounded px-2 py-0.5 text-white/85 outline-none w-44 font-mono"
          aria-label="Dev server command"
        />
        <input
          value={port}
          onChange={(e) => setPort(Number(e.target.value) || 0)}
          type="number"
          className="bg-white/5 rounded px-2 py-0.5 text-white/85 outline-none w-20 font-mono"
          aria-label="Port"
        />
        <button
          type="button"
          onClick={() => void start()}
          disabled={starting}
          className={cn(
            "px-2 py-0.5 rounded border border-hair",
            starting ? "text-white/30" : "text-white hover:bg-white/10",
          )}
        >
          {starting ? "Starting…" : url ? "Restart" : "Run"}
        </button>
        {url && (
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="px-2 py-0.5 rounded border border-hair text-white/80 hover:bg-white/10"
          >
            ⟳ Reload
          </button>
        )}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-sky-300/80 hover:underline truncate max-w-[28ch]"
          >
            ↗ open
          </a>
        )}
      </div>
      <div className="flex-1 min-h-0 bg-white/[0.02]">
        {error && (
          <div className="px-3 py-2 text-xs text-red-300/85 whitespace-pre-wrap">{error}</div>
        )}
        {url ? (
          <iframe
            key={reloadKey}
            src={url}
            title="Preview"
            className="w-full h-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          !error && (
            <div className="h-full flex items-center justify-center text-white/30 text-sm">
              Run the dev server to see a live preview
            </div>
          )
        )}
      </div>
    </div>
  );
}
