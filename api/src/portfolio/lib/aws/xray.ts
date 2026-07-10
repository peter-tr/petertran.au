import { XRayClient, BatchGetTracesCommand } from "@aws-sdk/client-xray";

const xray = new XRayClient({});

export interface TraceSegment {
  name: string;
  startOffsetMs: number;
  durationMs: number;
}

interface RawSegment {
  name: string;
  origin?: string;
  start_time: number;
  end_time?: number;
  inferred?: boolean;
  subsegments?: RawSegment[];
}

function collectAll(nodes: RawSegment[], out: RawSegment[]): void {
  for (const node of nodes) {
    out.push(node);
    if (node.subsegments) collectAll(node.subsegments, out);
  }
}

function displayName(node: RawSegment): string {
  // Both the Lambda platform's own wrapper segment and the segment our SDK
  // creates for the actual handler code report distinct `origin` values but
  // are both really "the Lambda" from a reader's point of view.
  return node.origin?.startsWith("AWS::Lambda") ? "Lambda" : node.name;
}

async function fetchBreakdown(traceId: string): Promise<TraceSegment[]> {
  const res = await xray.send(new BatchGetTracesCommand({ TraceIds: [traceId] }));
  const trace = res.Traces?.[0];
  if (!trace?.Segments?.length) return [];

  const topLevel = trace.Segments.map((s) =>
    s.Document ? (JSON.parse(s.Document) as RawSegment) : null
  ).filter((s): s is RawSegment => s !== null);
  if (topLevel.length === 0) return [];

  const all: RawSegment[] = [];
  collectAll(topLevel, all);

  const real = all.filter((node) => !node.inferred);
  const rootStart = Math.min(...real.map((node) => node.start_time));

  // Keep only the earliest (outermost) "Lambda" entry -- it already spans
  // the full invocation, so any inner one is a fully-overlapping duplicate.
  let sawLambda = false;
  const out: TraceSegment[] = [];
  for (const node of real.sort((a, b) => a.start_time - b.start_time)) {
    const name = displayName(node);
    if (name === "Lambda") {
      if (sawLambda) continue;
      sawLambda = true;
    }
    const end = node.end_time ?? node.start_time;
    out.push({
      name,
      startOffsetMs: Math.round((node.start_time - rootStart) * 1000),
      durationMs: Math.round((end - node.start_time) * 1000),
    });
  }

  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// X-Ray's own platform-level "Lambda" wrapper segment for an invocation
// typically becomes queryable via BatchGetTraces within milliseconds, but
// the segment our own SDK instrumentation creates (nesting the DynamoDB/
// Anthropic subsegments) can lag behind by a second or more before it's
// indexed. A request that finishes quickly leaves little real-world gap
// between "the response reached the browser" and "the dashboard asks for
// this trace", so it's easy to land in that window and see only the
// platform segment.
//
// Measured against the live table, propagation is highly variable -- some
// invocations resolved within ~3s, others took ~10s+. A single blocking
// call can't reasonably cover that whole range without making the reader
// stare at a spinner for 10+ seconds, so this only makes two quick, cheap
// attempts (catching the fast end of the distribution for free); the
// frontend (OperationRow.tsx) polls further on its own so a slow-to-index
// trace upgrades in place instead of blocking one long request.
const RETRY_DELAYS_MS = [700, 1500];

// Fetches a specific trace by ID (captured alongside each operation's stats
// row) and flattens its segment tree into a list ready for a waterfall chart.
// This only reflects what actually happened inside the Lambda invocation --
// X-Ray has no visibility into the browser or CloudFront/S3, which aren't
// part of the same trace.
//
// BatchGetTraces returns a flat array of segment documents, not a clean
// tree: our own SDK-created "work" segment nests its DynamoDB/Anthropic
// subsegments inline, but the Lambda platform's own wrapper segment is a
// separate top-level entry, and each downstream AWS call additionally gets
// an `inferred: true` twin (X-Ray's service-map bookkeeping) duplicating a
// subsegment that's already captured elsewhere in the same trace.
export async function getTraceBreakdown(traceId: string): Promise<TraceSegment[]> {
  let result = await fetchBreakdown(traceId);
  for (const delay of RETRY_DELAYS_MS) {
    // More than one segment means the "work" segment (with its DynamoDB/
    // Anthropic children) has landed, not just the bare platform wrapper.
    if (result.length > 1) break;
    await sleep(delay);
    result = await fetchBreakdown(traceId);
  }
  return result;
}
