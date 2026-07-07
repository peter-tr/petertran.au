import type { HourlyCount } from "../lib/graphql";

const CHART_WIDTH = 720;
const CHART_HEIGHT = 110;
const AXIS_BAND_HEIGHT = 22;
const BAR_GAP = 3;

// Scales the axis ceiling to the actual data range (rounded up to a clean
// 1/2/5/10 step) instead of some fixed large scale -- otherwise a personal
// site's real 0-8 requests/hour would render as a flat sliver at the bottom
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

function formatHour(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric" });
}

export default function RequestsChart({ data }: { data: HourlyCount[] }) {
  if (data.length === 0) return null;

  const max = Math.max(...data.map((d) => d.count));
  const axisMax = niceAxisMax(max);
  const barSlot = CHART_WIDTH / data.length;
  const barWidth = Math.min(24, barSlot - BAR_GAP);

  return (
    <div className="requests-chart">
      <p className="chart-title">requests by hour, last 24h</p>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT + AXIS_BAND_HEIGHT}`}
        className="requests-chart-svg"
        role="img"
        aria-label={`Bar chart of requests per hour for the last 24 hours, ranging from 0 to ${max}.`}
      >
        <text x={CHART_WIDTH} y={10} textAnchor="end" className="chart-axis-tick">
          {axisMax}
        </text>
        <line x1={0} y1={CHART_HEIGHT} x2={CHART_WIDTH} y2={CHART_HEIGHT} className="chart-baseline" />
        {data.map((d, i) => {
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
                {formatHour(d.timestamp)}: {d.count} request{d.count === 1 ? "" : "s"}
              </title>
            </rect>
          );
        })}
        <text x={0} y={CHART_HEIGHT + 16} className="chart-axis-label">
          {formatHour(data[0].timestamp)}
        </text>
        <text x={CHART_WIDTH} y={CHART_HEIGHT + 16} textAnchor="end" className="chart-axis-label">
          now
        </text>
      </svg>
    </div>
  );
}
