"use client";

import { useState, useCallback, useMemo, type ReactNode } from "react";
import { codeBlockFilename, downloadTextFile } from "@/lib/chat-export";

type Props = {
  lang: string | undefined;
  rawText: string;
  children: ReactNode;
};

// Only true JS runs in `new Function` — TS (`type X`, `: string`) throws a
// SyntaxError, so a "Run" on a TS snippet always failed. Offer Run for JS only.
const RUNNABLE_LANGS = new Set(["js", "javascript"]);

// Code blocks taller than this collapse behind a "Show more" toggle so a long
// snippet doesn't bury the rest of the reply on mobile.
const COLLAPSE_LINES = 14;

export default function CodeBlockWrapper({ lang, rawText, children }: Props) {
  const [copied, setCopied] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [outputError, setOutputError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const isRunnable = !!lang && RUNNABLE_LANGS.has(lang.toLowerCase());

  const lineCount = useMemo(
    () => rawText.replace(/\n$/, "").split("\n").length,
    [rawText],
  );
  const collapsible = lineCount > COLLAPSE_LINES;
  const clamped = collapsible && !expanded;

  // Static line-number gutter. Sits outside the horizontal scroll
  // container so the numbers stay pinned to the left edge while long
  // lines scroll under them; line-height matches the code pre so rows
  // align 1:1.
  const gutter = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1).join("\n"),
    [lineCount],
  );

  const handleCopy = useCallback(() => {
    const text = rawText.replace(/\n$/, "");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => fallbackCopy(text, setCopied));
    } else {
      fallbackCopy(text, setCopied);
    }
  }, [rawText]);

  const handleRun = useCallback(() => {
    setOutput(null);
    setOutputError(false);
    const logs: string[] = [];
    const consoleMock = {
      log: (...a: unknown[]) =>
        logs.push(a.map((x) => (typeof x === "object" ? JSON.stringify(x, null, 2) : String(x))).join(" ")),
      error: (...a: unknown[]) => logs.push("ERR: " + a.map(String).join(" ")),
      warn: (...a: unknown[]) => logs.push("WARN: " + a.map(String).join(" ")),
      info: (...a: unknown[]) => logs.push(a.map(String).join(" ")),
    };
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function("console", rawText);
      const result = fn(consoleMock);
      if (logs.length > 0) {
        setOutput(logs.join("\n"));
      } else if (result !== undefined && result !== null) {
        setOutput(String(result));
      } else {
        setOutput("✓ Executed (no output)");
      }
    } catch (err) {
      setOutput(err instanceof Error ? err.message : String(err));
      setOutputError(true);
    }
  }, [rawText]);

  const filename = useMemo(
    () => codeBlockFilename(lang, rawText),
    [lang, rawText],
  );
  const handleDownload = useCallback(() => {
    downloadTextFile(filename, rawText.replace(/\n$/, ""), "text/plain;charset=utf-8");
  }, [filename, rawText]);

  return (
    <div className="cbw">
      <div className="cbw-header">
        <span className="cbw-lang">{lang ?? "code"}</span>
        <div className="cbw-actions">
          {isRunnable && (
            <button type="button" className="cbw-run" onClick={handleRun}>
              ▶ Run
            </button>
          )}
          <button
            type="button"
            className="cbw-copy"
            onClick={handleDownload}
            title={`Download ${filename}`}
          >
            ⤓ File
          </button>
          <button type="button" className="cbw-copy" onClick={handleCopy}>
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      </div>
      <div className={`cbw-code${clamped ? " cbw-code--clamped" : ""}`}>
        <pre className="cbw-gutter" aria-hidden="true">
          {gutter}
        </pre>
        <div className="cbw-scroll">
          <pre className="md-code-block cbw-pre">
            {children}
          </pre>
        </div>
        {clamped && <div className="cbw-fade" aria-hidden />}
      </div>
      {collapsible && (
        <button
          type="button"
          className="cbw-expand"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded
            ? "▴ Show less"
            : `▾ Show ${lineCount - COLLAPSE_LINES} more lines`}
        </button>
      )}
      {output !== null && (
        <div className={`cbw-output${outputError ? " cbw-output--err" : ""}`}>
          <span className="cbw-output-label">OUTPUT</span>
          <pre className="cbw-output-text">{output}</pre>
        </div>
      )}
    </div>
  );
}

function fallbackCopy(text: string, setCopied: (v: boolean) => void) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  } catch { /* silent fail */ }
}
