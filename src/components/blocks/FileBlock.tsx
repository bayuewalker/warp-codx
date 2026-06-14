"use client";

import { useCallback, useMemo, useState } from "react";
import type { FilePayload } from "@/lib/types";
import { copyToClipboard, downloadTextFile } from "@/lib/chat-export";

type Props = {
  payload: FilePayload;
};

const KIND_ICON: Record<string, string> = {
  md: "📄",
  markdown: "📄",
  txt: "📄",
  json: "🧾",
  yaml: "🧾",
  yml: "🧾",
  csv: "📊",
};

/** Pretty byte size from a UTF-8 string, e.g. "12.4 KB". */
function byteSize(content: string): string {
  const bytes =
    typeof TextEncoder !== "undefined"
      ? new TextEncoder().encode(content).length
      : content.length;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Generated-file card — surfaces an artifact the assistant produced
 * (md / json / txt / yaml / csv) with its name, size, and Open /
 * Download / Copy-path actions, instead of pasting the whole file body
 * into the chat. "Open" toggles an inline preview when `content` is set.
 */
export default function FileBlock({ payload }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const ext = payload.kind?.toLowerCase() || extOf(payload.name);
  const icon = KIND_ICON[ext] ?? "📄";
  const path = payload.path?.trim() || payload.name;
  const hasContent = typeof payload.content === "string";

  const size = useMemo(() => {
    if (payload.size?.trim()) return payload.size.trim();
    if (hasContent) return byteSize(payload.content as string);
    return null;
  }, [payload.size, payload.content, hasContent]);

  const handleDownload = useCallback(() => {
    if (!hasContent) return;
    downloadTextFile(
      payload.name,
      payload.content as string,
      "text/plain;charset=utf-8",
    );
  }, [hasContent, payload.name, payload.content]);

  const handleCopyPath = useCallback(() => {
    copyToClipboard(path).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [path]);

  return (
    <div className="file-block">
      <div className="file-head">
        <span className="file-icon" aria-hidden="true">
          {icon}
        </span>
        <div className="file-meta">
          <div className="file-name">{payload.name}</div>
          {size && <div className="file-size">{size}</div>}
        </div>
      </div>
      <div className="file-actions">
        {hasContent && (
          <button
            type="button"
            className="file-btn"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Hide" : "Open"}
          </button>
        )}
        {hasContent && (
          <button type="button" className="file-btn" onClick={handleDownload}>
            Download
          </button>
        )}
        <button type="button" className="file-btn" onClick={handleCopyPath}>
          {copied ? "✓ Copied" : "Copy path"}
        </button>
      </div>
      {open && hasContent && (
        <div className="file-preview">
          <pre className="file-preview-pre">{payload.content}</pre>
        </div>
      )}
    </div>
  );
}
