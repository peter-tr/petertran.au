// Full-precision (down to the minute) relative-time formatter for
// Design.updatedAt, an ISO datetime rather than the day-granularity
// YYYY-MM-DD dates web/src/shared/lib/dates.ts formats - a design can be
// edited multiple times in one day and the gallery card should reflect that
// ("5m ago" vs just "today").
export function formatEditedAgo(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(days / 365);

  return `${years}y ago`;
}
