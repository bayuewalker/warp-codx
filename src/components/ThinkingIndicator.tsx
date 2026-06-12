"use client";

/**
 * Live "thinking" indicator — rendered ABOVE the composer while the assistant
 * streams. No box/pill: a colorful animated orb (spinning multi-color ring +
 * hue-cycling glow + `>_` ⇆ ❚❚ glyph crossfade), a phase label, and an elapsed
 * timer. Driven by real stream state, so it reflects actual generation.
 */

/** Format elapsed seconds as m:ss. */
function formatElapsed(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ThinkingIndicator({
  label,
  seconds,
}: {
  label?: string;
  seconds?: number;
}) {
  return (
    <span className="footer-thinking" role="status" aria-live="polite">
      <span className="footer-thinking-icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Colorful spinning ring (rotating dashed arc). */}
          <circle className="footer-think-ring" cx="12" cy="12" r="9.5" />
          {/* Glyph A — terminal prompt `>_` */}
          <g className="footer-think-glyph footer-think-glyph-a">
            <polyline points="8 9 11 12 8 15" />
            <line x1="13" y1="15" x2="16.5" y2="15" />
          </g>
          {/* Glyph B — pause bars ❚❚ */}
          <g className="footer-think-glyph footer-think-glyph-b">
            <line x1="10" y1="9" x2="10" y2="15" />
            <line x1="14" y1="9" x2="14" y2="15" />
          </g>
        </svg>
      </span>
      <span className="footer-thinking-label">{label || "thinking"}</span>
      {seconds && seconds > 0 ? (
        <span className="footer-thinking-time">{formatElapsed(seconds)}</span>
      ) : null}
    </span>
  );
}
