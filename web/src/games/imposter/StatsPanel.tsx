import { useEffect, useState } from "react";
import { runImposterQuery, IMPOSTER_STATS_QUERY, type ImposterStatsResult } from "./api";

function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
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
    </div>
  );
}
