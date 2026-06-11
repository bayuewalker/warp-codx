"use client";

import { useEffect, useRef, useState } from "react";
import type { Message } from "@/lib/types";
import {
  formatChatMarkdown,
  copyToClipboard,
  downloadTextFile,
  exportFilename,
} from "@/lib/chat-export";

/**
 * Header overflow menu (⋯) for whole-conversation actions: copy the transcript
 * to the clipboard, or download it as a Markdown file. Renders nothing when the
 * session has no messages yet.
 */
export default function ChatActionsMenu({
  messages,
  title,
}: {
  messages: Message[];
  title: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (messages.length === 0) {
    // Keep the header layout stable — occupy the slot without a control.
    return <span className="header-icon-btn" aria-hidden style={{ visibility: "hidden" }} />;
  }

  const doCopy = async () => {
    const ok = await copyToClipboard(formatChatMarkdown(messages, title));
    setFlash(ok ? "Copied chat" : "Copy failed");
    setOpen(false);
    setTimeout(() => setFlash(null), 1800);
  };

  const doExport = () => {
    downloadTextFile(exportFilename(title), formatChatMarkdown(messages, title));
    setOpen(false);
  };

  return (
    <div className="chat-actions" ref={rootRef}>
      <button
        type="button"
        className="header-icon-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Chat actions"
        title="Chat actions"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width={20} height={20}>
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>

      {flash && <span className="chat-actions-flash">{flash}</span>}

      {open && (
        <div className="chat-actions-menu" role="menu">
          <button type="button" role="menuitem" className="chat-actions-item" onClick={() => void doCopy()}>
            Copy chat
          </button>
          <button type="button" role="menuitem" className="chat-actions-item" onClick={doExport}>
            Export .md
          </button>
        </div>
      )}
    </div>
  );
}
