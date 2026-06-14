"use client";

import { useCallback, useMemo, useState } from "react";
import type { TerminalLine, TerminalLineType, TerminalPayload } from "@/lib/types";
import { copyToClipboard } from "@/lib/chat-export";

type Props = {
  payload: TerminalPayload;
};

/**
 * Auto-detect a line's colour role from its leading glyph when the
 * payload doesn't carry an explicit `type`. Keeps the assistant's job
 * simple — it can emit plain lines (`$ npm run build`, `✓ Build passed`)
 * and still get ANSI-style colouring.
 */
function detectType(text: string): TerminalLineType {
  const t = text.trimStart();
  if (t.startsWith("$") || t.startsWith("›") || t.startsWith("#")) return "in";
  if (/^✓|^✔|^√/.test(t)) return "ok";
  if (/^✕|^✗|^×|^ERROR\b|^FAIL/i.test(t)) return "err";
  if (/^⚠|^WARN/i.test(t)) return "warn";
  return "out";
}

export default function TerminalBlock({ payload }: Props) {
  const [copied, setCopied] = useState(false);
  const title = payload.title?.trim() || "TERMINAL";
  const lines = payload.lines ?? [];

  const plain = useMemo(
    () => lines.map((l) => l.text).join("\n"),
    [lines],
  );

  const handleCopy = useCallback(() => {
    copyToClipboard(plain).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [plain]);

  return (
    <div className="term-block">
      <div className="term-header">
        <span className="term-dots" aria-hidden="true">
          <span className="term-dot term-dot--r" />
          <span className="term-dot term-dot--y" />
          <span className="term-dot term-dot--g" />
        </span>
        <span className="term-title">{title}</span>
        {payload.cwd && <span className="term-cwd">{payload.cwd}</span>}
        <button type="button" className="term-copy" onClick={handleCopy}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <div className="term-scroll">
        <pre className="term-pre">
          {lines.map((line: TerminalLine, i) => {
            const type = line.type ?? detectType(line.text);
            return (
              <div className={`term-line term-line--${type}`} key={i}>
                {payload.showLineNumbers && (
                  <span className="term-lnum" aria-hidden="true">
                    {i + 1}
                  </span>
                )}
                <span className="term-ltext">{line.text || " "}</span>
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}
