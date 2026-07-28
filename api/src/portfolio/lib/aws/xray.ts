import { XRayClient, BatchGetTracesCommand } from "@aws-sdk/client-xray";

const xray = new XRayClient({});

export interface TraceSegment {
  id: string;
  parentId: string | null;
  name: string;
  startOffsetMs: number;
  durationMs: number;
  isPlatform: boolean;
}

interface RawSegment {
  id?: string;
  parent_id?: string;
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

// True for AWS's own bookkeeping segments (the Lambda invocation wrapper, an
// API Gateway stage hop) rather than a segment that reflects work our code
// did. A request now hops through api.petertran.au twice (browser -> the
// supergraph gateway, then supergraph -> the portfolio subgraph, both routed
// through the same REST API), so two of these plus the Lambda wrapper can
// land well before the real "Subgraph: portfolio"/DynamoDB/Anthropic
// segments are indexed - "some segments landed" is no longer a reliable
// signal that the interesting part of the trace has landed.
function isPlatformWrapper(node: RawSegment): boolean {
  return node.origin?.startsWith("AWS::Lambda") || node.origin?.startsWith("AWS::ApiGateway") || false;
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
  // Its subsegments (DynamoDB/Anthropic calls) are nested under that inner
  // duplicate in the raw document though, not the surviving one, so their
  // parent_id needs remapping onto whichever Lambda id survives or they'd
  // point at a dropped node and render as orphaned roots.
  let sawLambda = false;
  let survivingLambdaId: string | null = null;
  const idRemap = new Map<string, string>();
  const kept: { node: RawSegment; name: string }[] = [];
  real.sort((a, b) => a.start_time - b.start_time);
  for (const node of real) {
    const name = displayName(node);
    if (name === "Lambda") {
      if (sawLambda) {
        if (node.id && survivingLambdaId) idRemap.set(node.id, survivingLambdaId);
        continue;
      }
      sawLambda = true;
      survivingLambdaId = node.id ?? null;
    }
    kept.push({ node, name });
  }

  // Real X-Ray segment documents always carry an `id` (it's a required
  // field of the wire format), so this fallback only ever fires for
  // hand-written test fixtures that omit it.
  const withIds = kept.map(({ node, name }, i) => ({ node, name, id: node.id ?? `segment-${i}` }));
  const keptIds = new Set(withIds.map((k) => k.id));

  return withIds.map(({ node, name, id }) => {
    const end = node.end_time ?? node.start_time;
    const linkedParentId = node.parent_id ? (idRemap.get(node.parent_id) ?? node.parent_id) : null;

    return {
      id,
      parentId: linkedParentId && keptIds.has(linkedParentId) ? linkedParentId : null,
      name,
      startOffsetMs: Math.round((node.start_time - rootStart) * 1000),
      durationMs: Math.round((end - node.start_time) * 1000),
      isPlatform: isPlatformWrapper(node),
    };
  });
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
// row) and returns its segments as a flat list annotated with id/parentId so
// the frontend can rebuild the real call tree for a waterfall chart. This
// only reflects what actually happened inside the Lambda invocation -- X-Ray
// has no visibility into the browser or CloudFront/S3, which aren't part of
// the same trace.
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
    // A non-platform segment landing means the real work (DynamoDB/
    // Anthropic/subgraph) has been indexed, not just the Lambda/ApiGateway
    // wrapper segments every trace gets regardless of indexing progress.
    if (result.some((s) => !s.isPlatform)) break;
    await sleep(delay);
    result = await fetchBreakdown(traceId);
  }

  return result;
}
