import { useEffect, useRef, useState } from "react";
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

// A trace with only platform wrapper segments (the Lambda invocation, the
// api.petertran.au gateway hops) and nothing from our own SDK instrumentation
// almost always means X-Ray hasn't finished indexing this invocation yet,
// not that it truly only did that - the server already retries a couple of
// times for this, but propagation is variable enough (seconds, sometimes
// 10+) that it's worth polling here too rather than blocking one long
// request.
const MAX_CLIENT_POLL_ATTEMPTS = 5;
const CLIENT_POLL_DELAY_MS = 2200;

export default function OperationRow({ op }: { op: OperationStat }) {
  const [expanded, setExpanded] = useState(false);
  const [trace, setTrace] = useState<TraceSegment[] | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceIndexing, setTraceIndexing] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const pollAttempt = useRef(0);
  const unmounted = useRef(false);

  useEffect(
    () => () => {
      unmounted.current = true;
    },
    []
  );

  function fetchTrace(traceId: string) {
    runQuery<TraceBreakdownResult>(TRACE_BREAKDOWN_QUERY, { traceId })
      .then((result) => {
        if (unmounted.current) return;

        const segments = result.meta.traceBreakdown;
        setTrace(segments);

        const hasRealWork = segments.some((s) => !s.isPlatform);
        if (!hasRealWork && pollAttempt.current < MAX_CLIENT_POLL_ATTEMPTS) {
          pollAttempt.current += 1;
          setTraceIndexing(true);
          setTimeout(() => {
            if (!unmounted.current) fetchTrace(traceId);
          }, CLIENT_POLL_DELAY_MS);
        } else {
          setTraceIndexing(false);
        }
      })
      .catch((err) => {
        if (unmounted.current) return;
        setTraceError(err instanceof Error ? err.message : "Couldn't load trace.");
        setTraceIndexing(false);
      })
      .finally(() => {
        if (!unmounted.current) setTraceLoading(false);
      });
  }

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && op.lastTraceId && trace === null && !traceLoading) {
      setTraceLoading(true);
      setTraceError(null);
      pollAttempt.current = 0;
      fetchTrace(op.lastTraceId);
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
                  No query sample for this operation - mutations aren&apos;t sampled, to keep contact-form
                  submissions private.
                </p>
              )}

              {op.lastTraceId && (
                <>
                  <p className="ops-detail-label">Trace</p>
                  {traceLoading && <p className="status-line">// loading trace…</p>}
                  {traceError && <p className="status-line">// {traceError}</p>}
                  {trace && trace.length > 0 && <TraceWaterfall segments={trace} />}
                  {traceIndexing && (
                    <p className="status-line">// still finishing up the trace - refreshing…</p>
                  )}
                  {trace && trace.length === 0 && !traceIndexing && (
                    <p className="op-no-sample">// trace has expired or wasn&apos;t found.</p>
                  )}
                  {trace && trace.length > 0 && !traceIndexing && trace.every((s) => s.isPlatform) && (
                    <p className="op-no-sample">
                      // only X-Ray&apos;s platform segments landed in time - the real work never finished
                      indexing.
                    </p>
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
