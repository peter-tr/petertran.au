import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import OperationRow from "./OperationRow";
import type { OperationStat } from "../lib/graphql";

// See RequestsChart.test.tsx: the shared vitest setup file doesn't register
// RTL's auto-cleanup-after-each, so each render() here must be cleaned up
// explicitly to avoid leftover DOM from earlier tests colliding on shared
// text like "Resume".
afterEach(cleanup);

const { runQuery } = vi.hoisted(() => ({ runQuery: vi.fn() }));
vi.mock("../lib/graphql", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/graphql")>();

  return { ...actual, runQuery };
});

function baseOp(overrides: Partial<OperationStat> = {}): OperationStat {
  return {
    name: "Resume",
    count: 42,
    avgDurationMs: 120,
    lastQuery: null,
    lastVariables: null,
    lastTraceId: null,
    ...overrides,
  };
}

describe("OperationRow", () => {
  beforeEach(() => {
    runQuery.mockReset();
  });

  it("renders the summary row collapsed by default", () => {
    render(
      <table>
        <tbody>
          <OperationRow op={baseOp({ count: 1234, avgDurationMs: 88 })} />
        </tbody>
      </table>
    );

    expect(screen.getByText("▸")).toBeInTheDocument();
    expect(screen.getByText(/Resume/)).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("88ms")).toBeInTheDocument();
  });

  it("expands to show the query sample when the row is clicked", () => {
    render(
      <table>
        <tbody>
          <OperationRow op={baseOp({ lastQuery: "query Resume { person { name } }" })} />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByText(/Resume/));

    expect(screen.getByText("▾")).toBeInTheDocument();
    expect(screen.getByText("Query")).toBeInTheDocument();
    expect(screen.getByText(/person/)).toBeInTheDocument();
  });

  it("shows a placeholder message when there's no query sample (e.g. a mutation)", () => {
    render(
      <table>
        <tbody>
          <OperationRow op={baseOp({ lastQuery: null })} />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByText(/Resume/));

    expect(screen.getByText(/No query sample for this operation/)).toBeInTheDocument();
  });

  it("pretty-prints valid JSON variables and falls back to raw text otherwise", () => {
    const { rerender } = render(
      <table>
        <tbody>
          <OperationRow
            op={baseOp({ lastQuery: "query Foo { foo }", lastVariables: '{"id":"1"}' })}
          />
        </tbody>
      </table>
    );
    fireEvent.click(screen.getByText(/Resume/));

    expect(screen.getByText(/"id": "1"/)).toBeInTheDocument();

    rerender(
      <table>
        <tbody>
          <OperationRow op={baseOp({ lastQuery: "query Foo { foo }", lastVariables: "not json" })} />
        </tbody>
      </table>
    );

    expect(screen.getByText("not json")).toBeInTheDocument();
  });

  it("fetches and renders the trace waterfall when expanded with a lastTraceId", async () => {
    runQuery.mockResolvedValue({
      meta: {
        traceBreakdown: [
          { name: "Lambda: handler", startOffsetMs: 0, durationMs: 50 },
          { name: "DynamoDB: GetItem", startOffsetMs: 10, durationMs: 20 },
        ],
      },
    });

    render(
      <table>
        <tbody>
          <OperationRow op={baseOp({ lastTraceId: "trace-123" })} />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByText(/Resume/));

    expect(screen.getByText(/loading trace/)).toBeInTheDocument();
    expect(runQuery).toHaveBeenCalledWith(expect.any(String), { traceId: "trace-123" });

    await waitFor(() => expect(screen.getByText("Lambda: handler")).toBeInTheDocument());
    expect(screen.queryByText(/loading trace/)).not.toBeInTheDocument();
  });

  it("shows an error message when the trace fetch fails", async () => {
    runQuery.mockRejectedValue(new Error("trace fetch failed"));

    render(
      <table>
        <tbody>
          <OperationRow op={baseOp({ lastTraceId: "trace-123" })} />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByText(/Resume/));

    await waitFor(() => expect(screen.getByText(/trace fetch failed/)).toBeInTheDocument());
  });

  it("does not show a Trace section when there's no lastTraceId", () => {
    render(
      <table>
        <tbody>
          <OperationRow op={baseOp({ lastQuery: "query Foo { foo }", lastTraceId: null })} />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByText(/Resume/));

    expect(screen.queryByText("Trace")).not.toBeInTheDocument();
    expect(runQuery).not.toHaveBeenCalled();
  });
});
