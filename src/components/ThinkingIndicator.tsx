"use client";

/**
 * Animated "thinking" pill shown between message-submit and the first
 * streamed token. The dot-row predecessor lived here as `warp-thinking`;
 * this richer pill replaces it with the same role/aria contract so the
 * caller can swap in/out without changes.
 *
 * Visual contract:
 *   - Rounded pill (border-radius 999px) on the elevated surface.
 *   - Terminal `>_` glyph on the left, "Thinking" label in the middle
 *     (gradient sweep across blue → purple → teal), chevron on the
 *     right. The whole border carries a slow conic glow.
 *   - `prefers-reduced-motion` collapses every keyframe so accessibility
 *     users see a static pill instead of a kinetic shimmer.
 */
export default function ThinkingIndicator() {
  return (
    <div
      className="warp-thinking-pill"
      role="status"
      aria-live="polite"
      aria-label="Assistant is thinking"
    >
      <span className="warp-thinking-pill__glow" aria-hidden="true" />
      <span className="warp-thinking-pill__icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="5 8 9 12 5 16" />
          <line x1="11" y1="16" x2="17" y2="16" />
        </svg>
      </span>
      <span className="warp-thinking-pill__label">Thinking</span>
      <span className="warp-thinking-pill__chevron" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 6 15 12 9 18" />
        </svg>
      </span>
    </div>
  );
}
