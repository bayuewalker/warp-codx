"use client";

/**
 * Phase 3.5 — three-dot thinking indicator shown between message-submit
 * and the first streamed token. Replaces the prior plain-text
 * "WARP🔹CMD is thinking…" stub with a staggered-pulse dot row in the
 * same left-aligned column as CMD messages.
 *
 * Visual contract (per spec):
 *   - 3 dots, 6px diameter, 8px gap, var(--warp-blue) at 60% opacity.
 *   - Staggered opacity pulse, ~400ms cycle, dot 1 → 2 → 3 → repeat.
 *   - No text, no label, no transition on unmount — caller hides it
 *     instantly when the first token arrives.
 *
 * The keyframes live in `src/app/globals.css` (`@keyframes warp-think`)
 * so a single class encodes everything; no styled-components or CSS-in-JS
 * needed.
 */
export default function ThinkingIndicator() {
  return (
    <div
      className="warp-thinking"
      role="status"
      aria-live="polite"
      aria-label="WARP CMD is thinking"
    >
      <span className="warp-thinking-dot" />
      <span className="warp-thinking-dot" />
      <span className="warp-thinking-dot" />
    </div>
  );
}
