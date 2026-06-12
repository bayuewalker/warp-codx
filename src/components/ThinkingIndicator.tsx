"use client";

/**
 * "Thinking" pill shown between message-submit and the first streamed token.
 *
 * Positioned just above the chat input (not in the message list) so it
 * anchors to the bottom of the viewport on all screen sizes. Uses simple
 * 3-dot animation instead of conic-gradient border tricks that break on
 * Android Chrome.
 */
export default function ThinkingIndicator() {
  return (
    <div
      className="warp-thinking-pill"
      role="status"
      aria-live="polite"
      aria-label="Assistant is thinking"
    >
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
      <span className="warp-thinking-pill__dots" aria-hidden="true">
        <i /><i /><i />
      </span>
    </div>
  );
}
