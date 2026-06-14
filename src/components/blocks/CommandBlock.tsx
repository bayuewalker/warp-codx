"use client";

import { useCallback, useMemo, useState } from "react";
import type { CommandPayload } from "@/lib/types";
import { copyToClipboard } from "@/lib/chat-export";

type Props = {
  payload: CommandPayload;
};

/**
 * Renders one or more shell commands apart from the surrounding
 * explanation so the operator can copy the exact block to run — never
 * buried inside a paragraph. A single "Copy" grabs every line.
 */
export default function CommandBlock({ payload }: Props) {
  const [copied, setCopied] = useState(false);
  const title = payload.title?.trim() || "COMMAND";
  const lang = payload.lang?.trim() || "bash";
  const commands = (payload.commands ?? []).filter((c) => c.length > 0);

  const plain = useMemo(() => commands.join("\n"), [commands]);

  const handleCopy = useCallback(() => {
    copyToClipboard(plain).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [plain]);

  if (commands.length === 0) return null;

  return (
    <div className="cmd-block">
      <div className="cmd-header">
        <span className="cmd-title">{title}</span>
        <span className="cmd-lang">{lang}</span>
        <button type="button" className="cmd-copy" onClick={handleCopy}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <div className="cmd-scroll">
        <pre className="cmd-pre">
          {commands.map((line, i) => (
            <div className="cmd-line" key={i}>
              <span className="cmd-prompt" aria-hidden="true">
                $
              </span>
              <span className="cmd-text">{line}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
