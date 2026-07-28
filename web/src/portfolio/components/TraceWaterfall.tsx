import { useState } from "react";
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

interface TreeNode {
  segment: TraceSegment;
  children: TreeNode[];
}

// Rebuilds the real call tree from the flat, id/parentId-annotated list
// xray.ts returns (X-Ray's own BatchGetTraces response isn't a clean tree
// either - see the comment there - so this mirrors the same shape of work
// client-side instead of trusting list order to imply nesting).
function buildTree(segments: TraceSegment[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const segment of segments) byId.set(segment.id, { segment, children: [] });

  const roots: TreeNode[] = [];
  for (const segment of segments) {
    const node = byId.get(segment.id)!;
    const parent = segment.parentId ? byId.get(segment.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const byStart = (a: TreeNode, b: TreeNode) => a.segment.startOffsetMs - b.segment.startOffsetMs;
  for (const node of byId.values()) node.children.sort(byStart);
  roots.sort(byStart);

  return roots;
}

function countDescendants(node: TreeNode): number {
  let count = node.children.length;
  for (const child of node.children) count += countDescendants(child);

  return count;
}

interface VisibleRow {
  segment: TraceSegment;
  depth: number;
  hasChildren: boolean;
  descendantCount: number;
}

// Flattens back into a row list respecting the current collapse state, so
// rendering stays a plain .map() over `.trace-row` divs (same layout the
// component always used) rather than nested per-node containers that would
// need their own spacing/grid rules.
function flattenVisible(nodes: TreeNode[], depth: number, collapsed: Set<string>, out: VisibleRow[]): void {
  for (const node of nodes) {
    const hasChildren = node.children.length > 0;
    out.push({ segment: node.segment, depth, hasChildren, descendantCount: countDescendants(node) });
    if (hasChildren && !collapsed.has(node.segment.id)) {
      flattenVisible(node.children, depth + 1, collapsed, out);
    }
  }
}

export default function TraceWaterfall({ segments }: Readonly<{ segments: TraceSegment[] }>) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  if (segments.length === 0) return null;

  const totalMs = Math.max(...segments.map((s) => s.startOffsetMs + s.durationMs), 1);
  const rows: VisibleRow[] = [];
  flattenVisible(buildTree(segments), 0, collapsed, rows);

  function toggle(id: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });
  }

  return (
    <div className="trace-waterfall">
      {rows.map(({ segment, depth, hasChildren, descendantCount }) => {
        const leftPct = (segment.startOffsetMs / totalMs) * 100;
        const widthPct = Math.max((segment.durationMs / totalMs) * 100, 0.6);
        const isCollapsed = collapsed.has(segment.id);

        return (
          <div className="trace-row" key={segment.id}>
            <span className="trace-label" style={{ paddingLeft: `${depth * 1.1}rem` }}>
              {hasChildren ? (
                <button
                  type="button"
                  className="trace-toggle"
                  onClick={() => toggle(segment.id)}
                  aria-label={isCollapsed ? `Expand ${segment.name}` : `Collapse ${segment.name}`}
                >
                  {isCollapsed ? "▶" : "▼"}
                </button>
              ) : (
                <span className="trace-toggle-spacer" aria-hidden="true" />
              )}
              <span className="trace-label-text">{segment.name}</span>
              {hasChildren && isCollapsed && <span className="trace-child-count">+{descendantCount}</span>}
            </span>
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
