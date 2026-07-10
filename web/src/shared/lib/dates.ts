// Whole-day difference between today and a YYYY-MM-DD date - positive for a
// future date, negative for a past one.
export function daysBetween(dateStr: string): number {
  const target = new Date(`${dateStr}T00:00:00`).getTime();
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00`).getTime();
  return Math.round((target - today) / 86_400_000);
}

// Relative instead of absolute so the meta line stays short enough to fit a
// row on mobile - "9d ago" rather than "2026-07-01".
export function formatPurchasedAt(dateStr: string): string {
  const daysAgo = -daysBetween(dateStr);
  if (daysAgo <= 0) return "today";
  return `${daysAgo}d ago`;
}

export function formatExpiresAt(dateStr: string): string {
  const days = daysBetween(dateStr);
  if (days < 0) return `expired ${-days}d ago`;
  if (days === 0) return "expires today";
  return `expires in ${days}d`;
}
