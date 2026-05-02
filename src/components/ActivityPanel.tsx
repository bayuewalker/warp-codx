"use client";

import { useState } from "react";
import type { ActivityItem } from "@/hooks/useActivityPanel";
import { cn } from "@/lib/cn";

type Props = {
  items: ActivityItem[];
  elapsedSeconds: number;
  streaming: boolean;
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function RowIcon({ state }: { state: ActivityItem["state"] }) {
  if (state === "done") {
    return (
      <span className="ap-row-icon ap-row-icon--done" aria-label="Done">
        ✓
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="ap-row-icon ap-row-icon--active" aria-label="In progress">
        ●
      </span>
    );
  }
  return (
    <span className="ap-row-icon ap-row-icon--pending" aria-label="Pending">
      ○
    </span>
  );
}

/**
 * ActivityPanel — mounts above the input area while CMD is streaming.
 *
 * Collapsed by default: shows a single header row with a gear icon, an
 * action count, an elapsed timer (M:SS), and a Show/Hide toggle.
 *
 * Expanded: reveals one row per detected action with state icons:
 *   ✓ done  — teal, text-secondary
 *   ● active — blue pulse animation, text-primary
 *   ○ pending — muted
 *
 * Panel dismisses automatically 1.5 s after streaming ends
 * (the parent unmounts it via `visible` from `useActivityPanel`).
 */
export default function ActivityPanel({ items, elapsedSeconds, streaming }: Props) {
  const [expanded, setExpanded] = useState(false);

  const count = items.length;
  const status = streaming ? "Working" : "Done";
  const actionWord = count === 1 ? "action" : "actions";
  const headerLabel = `${status} — ${count} ${actionWord} · ${formatTime(elapsedSeconds)}`;

  return (
    <div
      className="activity-panel"
      role="status"
      aria-live="polite"
      aria-label={headerLabel}
    >
      {/* ── Header row — always visible ── */}
      <div className="ap-header">
        <span className="ap-header-icon" aria-hidden="true">
          ⚙
        </span>
        <span className="ap-header-label">{headerLabel}</span>
        <button
          type="button"
          className="ap-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="activity-panel-body"
          aria-label={expanded ? "Hide activity details" : "Show activity details"}
        >
          <span className={cn("ap-toggle-chevron", expanded && "ap-toggle-chevron--up")}>
            ▾
          </span>
          {expanded ? "Hide" : "Show"}
        </button>
      </div>

      {/* ── Expandable rows ── */}
      <div
        id="activity-panel-body"
        className={cn("ap-body", expanded && "ap-body--open")}
        aria-hidden={!expanded}
      >
        {count === 0 ? (
          <div className="ap-row ap-row--pending">
            <span className="ap-row-icon ap-row-icon--pending" aria-hidden="true">
              ○
            </span>
            <span className="ap-row-label">Waiting for actions…</span>
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className={cn(
                "ap-row",
                item.state === "done" && "ap-row--done",
                item.state === "active" && "ap-row--active",
                item.state === "pending" && "ap-row--pending",
              )}
            >
              <RowIcon state={item.state} />
              <span className="ap-row-label">{item.label}</span>
              {item.meta && (
                <span className="ap-row-meta" title={item.meta}>
                  {item.meta}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
