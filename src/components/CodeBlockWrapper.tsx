"use client";

import { useState, useCallback, type ReactNode } from "react";

type Props = {
  lang: string | undefined;
  rawText: string;
  children: ReactNode;
};

const JS_LANGS = new Set(["js", "javascript", "ts", "typescript"]);

export default function CodeBlockWrapper({ lang, rawText, children }: Props) {
  const [copied, setCopied] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [outputError, setOutputError] = useState(false);

  const isRunnable = !!lang && JS_LANGS.has(lang.toLowerCase());

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
          <button type="button" className="cbw-copy" onClick={handleCopy}>
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      </div>
      <div className="cbw-scroll">
        <pre className="md-code-block cbw-pre">
          {children}
        </pre>
      </div>
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
