/**
 * Shared display formatters (client-safe, no React dependency).
 * Single source of truth for helpers that several cards/views used to
 * redefine locally with identical bodies.
 */

/**
 * Compact relative age for card metadata: "now", "5m", "3h", "12d",
 * "2mo". Invalid dates render as "" so a malformed timestamp never
 * breaks a card.
 */
export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  return `${mo}mo`;
}

/** Display form of a link: drop the `http(s)://` scheme prefix. */
export function stripUrlScheme(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
