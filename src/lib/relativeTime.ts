/**
 * Indonesian short relative time. Examples: "baru saja", "5m lalu",
 * "2j lalu", "3h lalu", "4mg lalu".
 */
export function relativeTimeId(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  const seconds = Math.max(0, Math.floor((now.getTime() - t) / 1000));

  if (seconds < 45) return "baru saja";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}j lalu`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}h lalu`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}mg lalu`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}bl lalu`;
  const years = Math.floor(days / 365);
  return `${years}th lalu`;
}
