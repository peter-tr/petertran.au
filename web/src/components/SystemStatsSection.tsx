import { useEffect, useState } from "react";
import Section from "./Section";
import RequestsChart from "./RequestsChart";
import OperationRow from "./OperationRow";
import { runQuery, SYSTEM_STATS_QUERY, type SystemStatsResult } from "../lib/graphql";
import { QUERY_RAN_EVENT } from "../lib/events";

type Stats = SystemStatsResult["meta"]["systemStats"];

type NumericStatKey = Exclude<keyof Stats, "operations" | "operationsLast30Days" | "requestsByDay">;

const TILES: { key: NumericStatKey; label: string; format: (value: number) => string }[] = [
  { key: "requestsTotal", label: "total requests", format: (v) => v.toLocaleString() },
  { key: "avgDurationMs", label: "avg duration", format: (v) => `${v}ms` },
  { key: "aiQueriesTotal", label: "Ask Claude queries served", format: (v) => v.toLocaleString() },
  { key: "uniqueVisitorsTotal", label: "unique visitors", format: (v) => v.toLocaleString() },
];

type OperationsRange = "recent" | "all";

export default function SystemStatsSection() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opsRange, setOpsRange] = useState<OperationsRange>("recent");

  // Fetch once on mount, matching Hero.tsx's pattern: setState only happens
  // inside then/catch, never synchronously in the effect body itself.
  useEffect(() => {
    runQuery<SystemStatsResult>(SYSTEM_STATS_QUERY)
      .then((result) => setStats(result.meta.systemStats))
      .catch((err) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, []);

  // Also refetch whenever a query completes anywhere in the explorer --
  // the operation-stats write happens server-side before that response is
  // sent, so the numbers are already there to pick up by the time this fires.
  useEffect(() => {
    function onQueryRan() {
      setLoading(true);
      setError(null);
      runQuery<SystemStatsResult>(SYSTEM_STATS_QUERY)
        .then((result) => setStats(result.meta.systemStats))
        .catch((err) => setError(err instanceof Error ? err.message : "Something went wrong."))
        .finally(() => setLoading(false));
    }
    window.addEventListener(QUERY_RAN_EVENT, onQueryRan);
    return () => window.removeEventListener(QUERY_RAN_EVENT, onQueryRan);
  }, []);

  async function handleRefresh() {
    setLoading(true);
    setError(null);
    try {
      const result = await runQuery<SystemStatsResult>(SYSTEM_STATS_QUERY);
      setStats(result.meta.systemStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const activeOperations = stats
    ? opsRange === "recent"
      ? stats.operationsLast30Days
      : stats.operations
    : [];

  return (
    <Section id="stats" typeName="SystemStats">
      <p className="project-desc" style={{ marginBottom: "1rem" }}>
        Real numbers pulled from CloudWatch and DynamoDB for the Lambda behind this page - not mocked, and not
        polled continuously (CloudWatch only updates on its own ~1 minute cadence anyway).
      </p>

      {error && <p className="status-line">// couldn&apos;t load stats right now ({error}).</p>}

      {stats && (
        <>
          <div className="stats-grid">
            {TILES.map((tile) => (
              <div className="stat-tile" key={tile.key}>
                <span className="stat-value">{tile.format(stats[tile.key])}</span>
                <span className="stat-label">{tile.label}</span>
              </div>
            ))}
          </div>

          <RequestsChart data={stats.requestsByDay} />

          {activeOperations.length > 0 && (
            <div className="ops-block">
              <div className="ops-toggle" role="tablist" aria-label="Time range">
                <button
                  type="button"
                  role="tab"
                  aria-selected={opsRange === "recent"}
                  className={opsRange === "recent" ? "active" : ""}
                  onClick={() => setOpsRange("recent")}
                >
                  last 30 days
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={opsRange === "all"}
                  className={opsRange === "all" ? "active" : ""}
                  onClick={() => setOpsRange("all")}
                >
                  all time
                </button>
              </div>
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>operation</th>
                    <th>count</th>
                    <th>avg latency</th>
                    <th title="Estimated Lambda compute + invocation cost, summed across every call - not a real per-request AWS bill line item.">
                      est. cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeOperations.map((op) => (
                    <OperationRow op={op} key={op.name} />
                  ))}
                </tbody>
              </table>
              <p className="section-hint" style={{ marginTop: "0.6rem" }}>
                Click a row to see the actual query it ran, and its Lambda / DynamoDB / Anthropic trace
                breakdown where available.
              </p>
            </div>
          )}
        </>
      )}

      <button
        className="run-btn"
        type="button"
        onClick={handleRefresh}
        disabled={loading}
        style={{ marginTop: "1rem" }}
      >
        {loading ? "Refreshing…" : "Refresh ▸"}
      </button>
    </Section>
  );
}
