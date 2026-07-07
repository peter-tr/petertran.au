import { useState } from "react";
import {
  runQuery,
  TRACE_BREAKDOWN_QUERY,
  type OperationStat,
  type TraceSegment,
  type TraceBreakdownResult,
} from "../lib/graphql";
import TraceWaterfall from "./TraceWaterfall";
import GraphQLCode from "./GraphQLCode";

function formatVariables(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default function OperationRow({ op }: { op: OperationStat }) {
  const [expanded, setExpanded] = useState(false);
  const [trace, setTrace] = useState<TraceSegment[] | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && op.lastTraceId && trace === null && !traceLoading) {
      setTraceLoading(true);
      setTraceError(null);
      runQuery<TraceBreakdownResult>(TRACE_BREAKDOWN_QUERY, { traceId: op.lastTraceId })
        .then((result) => setTrace(result.meta.traceBreakdown))
        .catch((err) => setTraceError(err instanceof Error ? err.message : "Couldn't load trace."))
        .finally(() => setTraceLoading(false));
    }
  }

  return (
    <>
      <tr className="ops-row" onClick={toggle}>
        <td>
          <span className="ops-row-arrow">{expanded ? "▾" : "▸"}</span> {op.name}
        </td>
        <td>{op.count.toLocaleString()}</td>
        <td>{op.avgDurationMs}ms</td>
      </tr>
      {expanded && (
        <tr className="ops-detail-row">
          <td colSpan={3}>
            <div className="ops-detail">
              {op.lastQuery ? (
                <>
                  <p className="ops-detail-label">Query</p>
                  <GraphQLCode code={op.lastQuery} />
                  {op.lastVariables && (
                    <>
                      <p className="ops-detail-label">Variables</p>
                      <pre className="op-query op-variables">{formatVariables(op.lastVariables)}</pre>
                    </>
                  )}
                </>
              ) : (
                <p className="op-no-sample">
                  No query sample for this operation -- mutations aren&apos;t sampled, to keep contact-form
                  submissions private.
                </p>
              )}

              {op.lastTraceId && (
                <>
                  <p className="ops-detail-label">Trace</p>
                  {traceLoading && <p className="status-line">// loading trace…</p>}
                  {traceError && <p className="status-line">// {traceError}</p>}
                  {trace && trace.length > 0 && <TraceWaterfall segments={trace} />}
                  {trace && trace.length === 0 && (
                    <p className="op-no-sample">// trace has expired or wasn&apos;t found.</p>
                  )}
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
