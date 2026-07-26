---
"portfolio": patch
"web": patch
---

fix(portfolio,web): pretty-print the query sample and render the X-Ray trace breakdown as a real collapsible call tree

The "Query" sample in the ops stats panel was rendering as one unbroken
line - `GraphQLCode` now reformats it before syntax-highlighting.

The "Trace" waterfall discarded X-Ray's real segment hierarchy when
flattening subsegments into a list. `traceBreakdown` now returns each
segment's `id`/`parentId` (remapped past the platform-Lambda dedup so a
segment nested under the dropped duplicate doesn't become an orphaned
root), and `TraceWaterfall` rebuilds the tree client-side, rendering it
indented with a per-parent expand/collapse toggle instead of a flat list.

Also fixes an unrelated bug found while testing this in dev: OperationRow's
`unmounted` ref was only ever set `true` in its effect cleanup and never
reset on mount, so React 18 StrictMode's dev-only mount/unmount/remount
cycle permanently discarded every trace fetch after the first render.
