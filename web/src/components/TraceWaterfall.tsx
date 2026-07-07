import type { TraceSegment } from "../lib/graphql";

// Reuses the same categorical mapping as ArchitectureDiagram: compute work
// gets the signal accent, storage gets the string accent, everything else
// (the external Anthropic call) gets the type accent.
function colorFor(name: string): string {
  if (name.includes("Lambda")) return "var(--signal)";
  if (name.includes("DynamoDB")) return "var(--string)";
  if (name.includes("Anthropic")) return "var(--type)";
  return "var(--muted)";
}

export default function TraceWaterfall({ segments }: { segments: TraceSegment[] }) {
  if (segments.length === 0) return null;

  const totalMs = Math.max(...segments.map((s) => s.startOffsetMs + s.durationMs), 1);

  return (
    <div className="trace-waterfall">
      {segments.map((segment, i) => {
        const leftPct = (segment.startOffsetMs / totalMs) * 100;
        const widthPct = Math.max((segment.durationMs / totalMs) * 100, 0.6);
        return (
          <div className="trace-row" key={`${segment.name}-${i}`}>
            <span className="trace-label">{segment.name}</span>
            <div className="trace-track">
              <div
                className="trace-bar"
                style={{
                  marginLeft: `${leftPct}%`,
                  width: `${widthPct}%`,
                  background: colorFor(segment.name),
                }}
                title={`${segment.name}: ${segment.durationMs}ms`}
              />
            </div>
            <span className="trace-duration">{segment.durationMs}ms</span>
          </div>
        );
      })}
    </div>
  );
}
