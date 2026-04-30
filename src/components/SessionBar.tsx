"use client";

export interface SessionBarProps {
  /** Session label shown in the bar. When omitted the bar hides itself. */
  taskTitle?: string;
  /**
   * Progress 0–100. When undefined the rail hides — the spec says only
   * show the rail when a todo block is present in the latest assistant
   * turn, otherwise leave it out entirely.
   */
  progressPercent?: number;
  /** Hard hide override (defaults to true if a title is provided). */
  visible?: boolean;
  /** Tap handler — opens the drawer / session switcher. */
  onTap?: () => void;
}

export default function SessionBar({
  taskTitle,
  progressPercent,
  visible = true,
  onTap,
}: SessionBarProps) {
  if (!visible || !taskTitle) return null;

  const showRail = typeof progressPercent === "number";
  const pct = showRail
    ? Math.max(0, Math.min(100, progressPercent ?? 0))
    : 0;

  return (
    <button
      type="button"
      className="session-bar"
      onClick={onTap}
      aria-label={`Open session switcher for ${taskTitle}`}
    >
      <div className="session-icon" aria-hidden="true">
        {/* Filled hexagon — matches v2 mockup */}
        <svg viewBox="0 0 24 24">
          <polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5" />
        </svg>
      </div>
      <div className="session-title-block">
        <div className="session-title">
          <span>{taskTitle}</span>
          <span className="session-chev" aria-hidden="true">
            ▼
          </span>
        </div>
        {showRail && (
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
        )}
      </div>
    </button>
  );
}
