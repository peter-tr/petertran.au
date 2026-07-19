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
