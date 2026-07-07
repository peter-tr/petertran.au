import { XRayClient, BatchGetTracesCommand } from "@aws-sdk/client-xray";

const xray = new XRayClient({});

export interface TraceSegment {
  name: string;
  startOffsetMs: number;
  durationMs: number;
}

interface RawSegment {
  name: string;
  start_time: number;
  end_time?: number;
  subsegments?: RawSegment[];
}

function flatten(segment: RawSegment, rootStart: number, out: TraceSegment[]): void {
  const end = segment.end_time ?? segment.start_time;
  out.push({
    name: segment.name,
    startOffsetMs: Math.round((segment.start_time - rootStart) * 1000),
    durationMs: Math.round((end - segment.start_time) * 1000),
  });
  for (const child of segment.subsegments ?? []) {
    flatten(child, rootStart, out);
  }
}

// Fetches a specific trace by ID (captured alongside each operation's stats
// row) and flattens its segment tree into a list ready for a waterfall chart.
// This only reflects what actually happened inside the Lambda invocation --
// X-Ray has no visibility into the browser or CloudFront/S3, which aren't
// part of the same trace.
export async function getTraceBreakdown(traceId: string): Promise<TraceSegment[]> {
  const res = await xray.send(new BatchGetTracesCommand({ TraceIds: [traceId] }));
  const trace = res.Traces?.[0];
  if (!trace?.Segments?.length) return [];

  const parsed = trace.Segments.map((s) =>
    s.Document ? (JSON.parse(s.Document) as RawSegment) : null
  ).filter((s): s is RawSegment => s !== null);
  if (parsed.length === 0) return [];

  const rootStart = Math.min(...parsed.map((s) => s.start_time));
  const out: TraceSegment[] = [];
  for (const segment of parsed) flatten(segment, rootStart, out);

  return out.sort((a, b) => a.startOffsetMs - b.startOffsetMs);
}
