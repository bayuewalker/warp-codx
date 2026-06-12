"use client";

/**
 * WARP/input-shortcuts — bottom sheet that surfaces four quick
 * commands the operator runs constantly. Mounted via React portal
 * so the backdrop covers the whole viewport and the sheet escapes
 * the input area's stacking context (z-index dance avoided).
 *
 * Behaviour
 * ─────────
 * - Tap backdrop → dismiss (calls `onClose`).
 * - Tap a shortcut row → dismiss + invoke its handler. The first
 *   three rows funnel through `onShortcutSend(text)` which is
 *   wired to `ChatArea.handleSend` so the command auto-sends as
 *   the next user turn. The fourth row ("New Directive") calls
 *   `onNewDirective` instead, matching the `+` button in the app
 *   header.
 * - Esc key → dismiss (keyboard-friendly fallback for desktop QA).
 * - Body scroll is locked while the sheet is open so a long
 *   transcript can't scroll behind it.
 *
 * Animation
 * ─────────
 * Backdrop fades in (150ms) and the sheet slides up from the
 * bottom (200ms ease-out). Both are CSS-driven via the
 * `.warp-sheet`/`.warp-sheet-backdrop` rules in globals.css; we
 * just toggle a `data-state="open" | "closed"` attribute. Closing
 * waits for the slide-out before unmounting so the gesture stays
 * smooth. No new dependencies — pure React + CSS.
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ShortcutAction =
  | { kind: "send"; text: string }
  | { kind: "new-directive" };

type Shortcut = {
  id: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
  action: ShortcutAction;
};

const SHORTCUTS: Shortcut[] = [
  {
    id: "explain-code",
    icon: <span aria-hidden="true">💡</span>,
    title: "Explain code",
    subtitle: "Walk through code you paste, step by step",
    action: {
      kind: "send",
      text: "Explain this code step by step, then point out anything worth improving:\n\n",
    },
  },
  {
    id: "debug-error",
    icon: <span aria-hidden="true">🐞</span>,
    title: "Debug an error",
    subtitle: "Trace a stack trace or bug and fix it",
    action: {
      kind: "send",
      text: "Help me debug this. Here's the error / stack trace and the relevant code:\n\n",
    },
  },
  {
    id: "review-code",
    icon: <span aria-hidden="true">🔍</span>,
    title: "Review code",
    subtitle: "Get a review with concrete suggestions",
    action: {
      kind: "send",
      text: "Review this code for correctness, edge cases, and readability, and suggest concrete improvements:\n\n",
    },
  },
  {
    id: "test-responses",
    icon: <span aria-hidden="true">🎨</span>,
    title: "Test responses",
    subtitle: "Ask the AI to demo every render style (live answer)",
    action: {
      kind: "send",
      text:
        "Demonstrate every response format you support, as a single answer. " +
        "Use ONLY rich, structured blocks — no plain paragraphs between them. " +
        "Include, in order: a 2-column key/value table; a Component/Status " +
        "table; a task checklist (## ✅ TODO with - [ ] / - [x] items); a " +
        "syntax-highlighted code block; a terminal/bash code block; and the " +
        "rich blocks warp-todos, warp-action, warp-diff, and warp-status with " +
        "realistic sample data. Keep prose to at most one short caption per " +
        "section.",
    },
  },
  {
    id: "new-chat",
    icon: <span aria-hidden="true">✦</span>,
    title: "New chat",
    subtitle: "Start a fresh session",
    action: { kind: "new-directive" },
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
  /** Send a text command as the next user turn. */
  onShortcutSend: (text: string) => void;
  /** Open a brand-new session (mirrors the `+` header button). */
  onNewDirective: () => void;
};

export default function ShortcutSheet({
  open,
  onClose,
  onShortcutSend,
  onNewDirective,
}: Props) {
  // Track three states: hidden (not in DOM), entering (mounted, animate-in
  // on next frame), open (idle), closing (animate-out before unmount).
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Yield one frame so the initial `data-state="closed"` paints
      // before the `open` transition kicks in. Without this the
      // sheet snaps in instead of sliding up.
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    if (mounted) {
      setVisible(false);
      // Match the slide-out duration in CSS (200ms).
      const id = window.setTimeout(() => setMounted(false), 220);
      return () => window.clearTimeout(id);
    }
  }, [open, mounted]);

  // Esc to dismiss + body scroll lock while the sheet is mounted.
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [mounted, onClose]);

  if (!mounted || typeof document === "undefined") return null;

  const state = visible ? "open" : "closed";

  const fire = (action: ShortcutAction) => {
    onClose();
    if (action.kind === "send") {
      onShortcutSend(action.text);
    } else {
      onNewDirective();
    }
  };

  return createPortal(
    <div
      className="warp-sheet-root"
      role="dialog"
      aria-modal="true"
      aria-label="Quick commands"
    >
      <div
        className="warp-sheet-backdrop"
        data-state={state}
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="warp-sheet" data-state={state}>
        <div className="warp-sheet-grip" aria-hidden="true" />
        <div className="warp-sheet-header">Quick Commands</div>
        <ul className="warp-sheet-list">
          {SHORTCUTS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="warp-sheet-row"
                onClick={() => fire(s.action)}
              >
                <span className="warp-sheet-row-icon">{s.icon}</span>
                <span className="warp-sheet-row-text">
                  <span className="warp-sheet-row-title">{s.title}</span>
                  <span className="warp-sheet-row-sub">{s.subtitle}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
