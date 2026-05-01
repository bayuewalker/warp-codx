"use client";

/**
 * Phase 3.5 — Background Task Mode wrapper.
 *
 * When CMD's response carries 2+ rich blocks (ActionCard, DiffBlock,
 * TodoBlock, StatusTable, IssueCard, PRCard, PRListCard) we collapse
 * the entire group behind a single "activity summary" header so the
 * chat scrollback stays scannable. This mirrors the Replit Agent
 * "7 actions" collapsed pattern.
 *
 * Spec rules enforced by the caller (`MessageContent.tsx`):
 *   - Prose stays OUTSIDE this wrapper (always visible).
 *   - 1 rich block → no wrap (the caller renders the block directly).
 *   - 2+ rich blocks → wrap inside <CollapsibleSection> with default
 *     state collapsed.
 *
 * State is per-message useState — never persisted. The smooth height
 * transition uses inline `max-height` (200ms ease) rather than a CSS
 * grid trick because the body height is unknown ahead of time and we
 * want the animation to play in both directions; we transition from
 * 0 → a generous max (5000px) which covers any reasonable assistant
 * turn while still giving the eye a smooth feel.
 */

import { useId, useState, type ReactNode } from "react";

type Props = {
  /** Number of rich blocks contained — drives the summary text. */
  count: number;
  /** Optional one-line verb summarising the body, e.g. "Working". */
  verb?: string;
  children: ReactNode;
};

export default function CollapsibleSection({
  count,
  verb = "Working",
  children,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();

  return (
    <div
      className="my-3 rounded-md overflow-hidden warp-collapsible"
      style={{
        background: "var(--bg-elev-1)",
        border: "1px solid var(--border-soft)",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-white/5 transition-colors"
      >
        <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/65 min-w-0">
          <span aria-hidden="true">⚙</span>
          <span className="truncate">
            {verb} — {count} action{count === 1 ? "" : "s"}
          </span>
        </span>
        <span className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-white/55 shrink-0">
          <span aria-hidden="true">{expanded ? "▴" : "▾"}</span>
          <span>{expanded ? "Hide" : "Show"}</span>
        </span>
      </button>
      <div
        id={bodyId}
        role="region"
        className="warp-collapsible-body"
        style={{
          maxHeight: expanded ? "5000px" : "0px",
          opacity: expanded ? 1 : 0,
          transition:
            "max-height 200ms ease, opacity 200ms ease",
          overflow: "hidden",
        }}
        aria-hidden={!expanded}
      >
        <div className="px-4 pt-1 pb-3">{children}</div>
      </div>
    </div>
  );
}
