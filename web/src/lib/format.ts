const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMonth(value: string | null): string {
  if (!value) return "Present";
  const [year, month] = value.split("-");
  const idx = Number(month) - 1;
  return `${MONTHS[idx] ?? month} ${year}`;
}

export function formatRange(start: string, end: string | null): string {
  return `${formatMonth(start)} — ${formatMonth(end)}`;
}

// A personal site's real per-operation Lambda cost is a small fraction of a
// cent even summed across every call it's ever had - toFixed(4) (as used for
// the footer's all-time totals) would round everything here down to "$0.0000",
// so this needs more decimal places to actually show a real digit.
export function formatCostUsd(value: number): string {
  return `$${value.toFixed(7)}`;
}
