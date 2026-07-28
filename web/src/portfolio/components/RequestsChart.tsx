import { useId, useState } from "react";
import type { DailyCount } from "../lib/graphql";

const CHART_WIDTH = 720;
const CHART_HEIGHT = 110;
const AXIS_BAND_HEIGHT = 22;
const BAR_GAP = 3;

type Range = "1d" | "7d" | "all";

// How many trailing days each range shows (null = every day there is), and
// how it reads in the chart's accessible description.
const RANGE_DAYS: Record<Range, number | null> = { "1d": 1, "7d": 7, all: null };
const RANGE_LABELS: Record<Range, string> = {
  "1d": "the last 1 day",
  "7d": "the last 7 days",
  all: "all time",
};

// Scales the axis ceiling to the actual data range (rounded up to a clean
// 1/2/5/10 step) instead of some fixed large scale - otherwise a personal
// site's real 0-8 requests/day would render as a flat sliver at the bottom
// of an oversized chart.
function niceAxisMax(max: number): number {
  if (max <= 0) return 1;

  const withHeadroom = max * 1.15;
  const magnitude = Math.pow(10, Math.floor(Math.log10(withHeadroom)));
  for (const step of [1, 2, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= withHeadroom) return candidate;
  }

  return 10 * magnitude;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function RequestsChart({ data }: Readonly<{ data: DailyCount[] }>) {
  const [range, setRange] = useState<Range>("7d");
  const titleId = useId();

  if (data.length === 0) return null;

  const days = RANGE_DAYS[range];
  const visible = days === null ? data : data.slice(-days);
  const max = Math.max(...visible.map((d) => d.count));
  const axisMax = niceAxisMax(max);
  const barSlot = CHART_WIDTH / visible.length;
  const barWidth = Math.min(24, barSlot - BAR_GAP);
  const rangeLabel = RANGE_LABELS[range];

  return (
    <div className="requests-chart">
      <p className="chart-title">requests by day</p>
      <div className="ops-toggle" role="tablist" aria-label="Chart time range">
        <button
          type="button"
          role="tab"
          aria-selected={range === "1d"}
          className={range === "1d" ? "active" : ""}
          onClick={() => setRange("1d")}
        >
          last 1 day
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={range === "7d"}
          className={range === "7d" ? "active" : ""}
          onClick={() => setRange("7d")}
        >
          last 7 days
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={range === "all"}
          className={range === "all" ? "active" : ""}
          onClick={() => setRange("all")}
        >
          all time
        </button>
      </div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT + AXIS_BAND_HEIGHT}`}
        className="requests-chart-svg"
        aria-labelledby={titleId}
      >
        {/* SVG's own native accessible-name element, rather than an
            aria-label behind role="img". */}
        <title id={titleId}>
          Bar chart of requests per day for {rangeLabel}, ranging from 0 to {max}.
        </title>
        <text x={CHART_WIDTH} y={10} textAnchor="end" className="chart-axis-tick">
          {axisMax}
        </text>
        <line x1={0} y1={CHART_HEIGHT} x2={CHART_WIDTH} y2={CHART_HEIGHT} className="chart-baseline" />
        {visible.map((d, i) => {
          const barHeight = (d.count / axisMax) * CHART_HEIGHT;
          const x = i * barSlot + (barSlot - barWidth) / 2;
          const y = CHART_HEIGHT - barHeight;

          return (
            <rect
              key={d.timestamp}
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={2}
              className="chart-bar"
            >
              <title>
                {formatDay(d.timestamp)}: {d.count} request{d.count === 1 ? "" : "s"}
              </title>
            </rect>
          );
        })}
        <text x={0} y={CHART_HEIGHT + 16} className="chart-axis-label">
          {formatDay(visible[0].timestamp)}
        </text>
        <text x={CHART_WIDTH} y={CHART_HEIGHT + 16} textAnchor="end" className="chart-axis-label">
          today
        </text>
      </svg>
    </div>
  );
}
