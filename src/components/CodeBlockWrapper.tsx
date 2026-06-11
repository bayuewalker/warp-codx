"use client";

import { useState, useCallback, useMemo, type ReactNode } from "react";

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

  // Pick a sensible filename extension per language so the saved file
  // opens in the right viewer. Unknown langs fall back to `.txt`.
  const handleDownload = useCallback(() => {
    const ext = extensionFor(lang);
    const filename = `snippet-${Date.now().toString(36)}.${ext}`;
    const blob = new Blob([rawText.replace(/\n$/, "") + "\n"], {
      type: "text/plain;charset=utf-8",
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }, [lang, rawText]);

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
            className="cbw-download"
            onClick={handleDownload}
            title="Download as file"
            aria-label="Download as file"
          >
            ↓ File
          </button>
          <button type="button" className="cbw-copy" onClick={handleCopy}>
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      </div>
      <div className={`cbw-scroll${clamped ? " cbw-scroll--clamped" : ""}`}>
        <pre className="md-code-block cbw-pre">
          {children}
        </pre>
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

const LANG_EXT: Record<string, string> = {
  js: "js", javascript: "js", jsx: "jsx",
  ts: "ts", typescript: "ts", tsx: "tsx",
  py: "py", python: "py",
  rb: "rb", ruby: "rb",
  go: "go", rs: "rs", rust: "rs",
  java: "java", kt: "kt", kotlin: "kt",
  c: "c", h: "h", cpp: "cpp", "c++": "cpp",
  cs: "cs", "c#": "cs", csharp: "cs",
  php: "php", swift: "swift",
  sh: "sh", bash: "sh", zsh: "sh", shell: "sh",
  yaml: "yml", yml: "yml",
  json: "json", toml: "toml",
  xml: "xml", html: "html", css: "css", scss: "scss",
  md: "md", markdown: "md",
  sql: "sql",
  diff: "diff", patch: "patch",
  env: "env", dockerfile: "Dockerfile",
};

function extensionFor(lang: string | undefined): string {
  if (!lang) return "txt";
  return LANG_EXT[lang.toLowerCase()] ?? "txt";
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
