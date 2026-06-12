"use client";

import { useRef, useState } from "react";
import { authFetch } from "@/lib/api-fetch";

/**
 * Request/response terminal for the IDE.
 *
 * Each command POSTs to /api/workspace/exec and appends its combined output to
 * a scrollback log. Not a live PTY (long-lived servers go through the preview
 * tab, which detaches them) — but enough to run builds, tests, git, and npm.
 */

type Line = { kind: "cmd" | "out" | "err"; text: string };

type Props = {
  /** Called after a command finishes, so the parent can refresh the file tree. */
  onAfterCommand?: () => void;
};

export default function TerminalPane({ onAfterCommand }: Props) {
  const [lines, setLines] = useState<Line[]>([
    { kind: "out", text: "WARP CodX workspace shell. Type a command and press Enter." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  function append(next: Line[]) {
    setLines((prev) => {
      const merged = [...prev, ...next];
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
      return merged;
    });
  }

  async function run() {
    const command = input.trim();
    if (!command || busy) return;
    setInput("");
    append([{ kind: "cmd", text: `$ ${command}` }]);
    setBusy(true);
    try {
      const res = await authFetch("/api/workspace/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const json = (await res.json()) as {
        output?: string;
        exitCode?: number;
        error?: string;
      };
      if (!res.ok) {
        append([{ kind: "err", text: json.error || `Failed (${res.status})` }]);
      } else {
        const out = (json.output ?? "").replace(/\n$/, "");
        if (out) append([{ kind: json.exitCode ? "err" : "out", text: out }]);
        if (json.exitCode) append([{ kind: "err", text: `[exit ${json.exitCode}]` }]);
      }
    } catch (e) {
      append([{ kind: "err", text: e instanceof Error ? e.message : "Network error" }]);
    } finally {
      setBusy(false);
      onAfterCommand?.();
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 font-mono text-[12.5px] leading-5">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto px-3 py-2 space-y-0.5">
        {lines.map((l, i) => (
          <pre
            key={i}
            className={
              l.kind === "cmd"
                ? "text-sky-300/90 whitespace-pre-wrap break-words"
                : l.kind === "err"
                  ? "text-red-300/85 whitespace-pre-wrap break-words"
                  : "text-white/75 whitespace-pre-wrap break-words"
            }
          >
            {l.text}
          </pre>
        ))}
        {busy && <div className="text-white/40">running…</div>}
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-hair">
        <span className="text-emerald-300/80">$</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
          disabled={busy}
          placeholder="npm test"
          spellCheck={false}
          className="flex-1 bg-transparent outline-none text-white/90 placeholder:text-white/25"
        />
      </div>
    </div>
  );
}
