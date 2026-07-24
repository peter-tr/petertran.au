import { useEffect, useMemo, useState } from "react";
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
type OpsSortKey = "count" | "avgDurationMs";
type OpsSort = { key: OpsSortKey; direction: "asc" | "desc" } | null;

export default function SystemStatsSection({ staggerDelayMs = 0 }: { staggerDelayMs?: number }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opsRange, setOpsRange] = useState<OperationsRange>("recent");
  const [opsSort, setOpsSort] = useState<OpsSort>(null);

  function toggleOpsSort(key: OpsSortKey) {
    setOpsSort((current) =>
      current?.key === key
        ? current.direction === "desc"
          ? { key, direction: "asc" }
          : null
        : { key, direction: "desc" }
    );
  }

  // Fetch once on mount, matching Hero.tsx's pattern: setState only happens
  // inside then/catch, never synchronously in the effect body itself.
  // staggerDelayMs (see Home.tsx/useStaggerHomeFetches) lets Hero's request
  // land first and claim a warm portfolio-graphql slot before this one fires.
  useEffect(() => {
    const timer = setTimeout(() => {
      runQuery<SystemStatsResult>(SYSTEM_STATS_QUERY)
        .then((result) => setStats(result.meta.systemStats))
        .catch((err) => setError(err instanceof Error ? err.message : "Something went wrong."));
    }, staggerDelayMs);

    return () => clearTimeout(timer);
  }, [staggerDelayMs]);

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

  const activeOperations = useMemo(() => {
    if (!stats) return [];

    return opsRange === "recent" ? stats.operationsLast30Days : stats.operations;
  }, [stats, opsRange]);

  const sortedOperations = useMemo(() => {
    if (!opsSort) return activeOperations;

    const { key, direction } = opsSort;

    return [...activeOperations].sort((a, b) => (direction === "desc" ? b[key] - a[key] : a[key] - b[key]));
  }, [activeOperations, opsSort]);

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
                    <SortableOpsHeader
                      label="count"
                      sortKey="count"
                      sort={opsSort}
                      onToggle={toggleOpsSort}
                    />
                    <SortableOpsHeader
                      label="avg latency"
                      sortKey="avgDurationMs"
                      sort={opsSort}
                      onToggle={toggleOpsSort}
                    />
                  </tr>
                </thead>
                <tbody>
                  {sortedOperations.map((op) => (
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

function SortableOpsHeader({
  label,
  sortKey,
  sort,
  onToggle,
}: {
  label: string;
  sortKey: OpsSortKey;
  sort: OpsSort;
  onToggle: (key: OpsSortKey) => void;
}) {
  const active = sort?.key === sortKey ? sort.direction : null;

  return (
    <th aria-sort={active === "desc" ? "descending" : active === "asc" ? "ascending" : "none"}>
      <button type="button" className="ops-sort-btn" onClick={() => onToggle(sortKey)}>
        {label}
        <span className="ops-sort-arrow">{active ? (active === "desc" ? "▾" : "▴") : ""}</span>
      </button>
    </th>
  );
}
