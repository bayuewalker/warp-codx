"use client";

import { Hexagon, ChevronDown } from "lucide-react";

export interface SessionBarProps {
  taskTitle?: string;
  progressPercent?: number; // 0-100
  visible?: boolean;
}

export default function SessionBar({
  taskTitle,
  progressPercent,
  visible = false,
}: SessionBarProps) {
  // Phase 2.5: render only when visible AND has task data.
  // Phase 3 will pass real data from active issue/PR state.
  if (!visible || !taskTitle) return null;

  const pct = Math.max(0, Math.min(100, progressPercent ?? 0));

  return (
    <div className="session-bar">
      <div className="session-icon" aria-hidden="true">
        <Hexagon size={9} strokeWidth={2} />
      </div>
      <div className="session-title-block">
        <div className="session-title">
          <span>{taskTitle}</span>
          <ChevronDown size={9} className="session-chev" />
        </div>
        <div
          className="session-progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="session-progress-bar"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
