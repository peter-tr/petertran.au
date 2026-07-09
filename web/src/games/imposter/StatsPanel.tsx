import { useEffect, useState } from "react";
import { runImposterQuery, IMPOSTER_STATS_QUERY, type ImposterDailyCount, type ImposterStatsResult } from "./api";

const CHART_WIDTH = 320;
const CHART_HEIGHT = 60;
const BAR_GAP = 2;

function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function niceAxisMax(max: number): number {
  return max <= 0 ? 1 : max;
}

function DailyChart({ data }: { data: ImposterDailyCount[] }) {
  const max = Math.max(...data.map((d) => d.count));
  const axisMax = niceAxisMax(max);
  const barSlot = CHART_WIDTH / data.length;
  const barWidth = Math.max(1, barSlot - BAR_GAP);

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="imposter-stats-chart"
      role="img"
      aria-label={`Games started per day over the last ${data.length} days, up to ${max}.`}
    >
      {data.map((d, i) => {
        const barHeight = (d.count / axisMax) * (CHART_HEIGHT - 4);
        const x = i * barSlot + (barSlot - barWidth) / 2;
        const y = CHART_HEIGHT - barHeight;
        return (
          <rect key={d.timestamp} x={x} y={y} width={barWidth} height={Math.max(barHeight, 1)} rx={1}>
            <title>
              {formatDay(d.timestamp)}: {d.count} game{d.count === 1 ? "" : "s"}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

export default function StatsPanel() {
  const [stats, setStats] = useState<ImposterStatsResult["imposterStats"] | null>(null);

  useEffect(() => {
    runImposterQuery<ImposterStatsResult>(IMPOSTER_STATS_QUERY)
      .then((res) => setStats(res.imposterStats))
      .catch(() => {
        // Stats are a nice-to-have footer, not core functionality - fail quietly.
      });
  }, []);

  if (!stats || stats.gamesPlayedTotal === 0) return null;

  return (
    <div className="imposter-stats">
      <p className="imposter-stats-title">Games played all-time</p>
      <div className="imposter-stats-row">
        <div className="imposter-stat-tile">
          <p className="imposter-stat-value">{stats.gamesPlayedTotal}</p>
          <p className="imposter-stat-label">started</p>
        </div>
        <div className="imposter-stat-tile">
          <p className="imposter-stat-value">{stats.gamesCompletedTotal}</p>
          <p className="imposter-stat-label">completed</p>
        </div>
        <div className="imposter-stat-tile">
          <p className="imposter-stat-value">{formatDuration(stats.avgGameDurationMs)}</p>
          <p className="imposter-stat-label">avg. length</p>
        </div>
      </div>
      <DailyChart data={stats.gamesByDay} />
    </div>
  );
}
