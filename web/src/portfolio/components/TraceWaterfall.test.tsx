import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import TraceWaterfall from "./TraceWaterfall";
import type { TraceSegment } from "../lib/graphql";

// See RequestsChart.test.tsx: the shared vitest setup file doesn't register
// RTL's auto-cleanup-after-each, so each render() here must be cleaned up
// explicitly.
afterEach(cleanup);

describe("TraceWaterfall", () => {
  it("renders nothing for an empty segment list", () => {
    const { container } = render(<TraceWaterfall segments={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders one row per segment with its name and duration", () => {
    const segments: TraceSegment[] = [
      {
        id: "1",
        parentId: null,
        name: "Lambda: handler",
        startOffsetMs: 0,
        durationMs: 120,
        isPlatform: true,
      },
      {
        id: "2",
        parentId: null,
        name: "DynamoDB: GetItem",
        startOffsetMs: 10,
        durationMs: 30,
        isPlatform: false,
      },
      {
        id: "3",
        parentId: null,
        name: "Anthropic: messages.create",
        startOffsetMs: 40,
        durationMs: 900,
        isPlatform: false,
      },
    ];
    const { container } = render(<TraceWaterfall segments={segments} />);

    const rows = container.querySelectorAll(".trace-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector(".trace-label")?.textContent).toBe("Lambda: handler");
    expect(rows[0].querySelector(".trace-duration")?.textContent).toBe("120ms");
  });

  it("colors bars by segment kind (Lambda/DynamoDB/Anthropic/other)", () => {
    const segments: TraceSegment[] = [
      {
        id: "1",
        parentId: null,
        name: "Lambda: handler",
        startOffsetMs: 0,
        durationMs: 10,
        isPlatform: true,
      },
      {
        id: "2",
        parentId: null,
        name: "DynamoDB: GetItem",
        startOffsetMs: 0,
        durationMs: 10,
        isPlatform: false,
      },
      {
        id: "3",
        parentId: null,
        name: "Anthropic: messages.create",
        startOffsetMs: 0,
        durationMs: 10,
        isPlatform: false,
      },
      {
        id: "4",
        parentId: null,
        name: "Something else",
        startOffsetMs: 0,
        durationMs: 10,
        isPlatform: false,
      },
    ];
    const { container } = render(<TraceWaterfall segments={segments} />);

    const bars = container.querySelectorAll(".trace-bar");
    expect((bars[0] as HTMLElement).style.background).toBe("var(--signal)");
    expect((bars[1] as HTMLElement).style.background).toBe("var(--string)");
    expect((bars[2] as HTMLElement).style.background).toBe("var(--type)");
    expect((bars[3] as HTMLElement).style.background).toBe("var(--muted)");
  });

  it("positions bars proportionally to the total trace duration", () => {
    const segments: TraceSegment[] = [
      { id: "1", parentId: null, name: "First", startOffsetMs: 0, durationMs: 50, isPlatform: false },
      { id: "2", parentId: null, name: "Second", startOffsetMs: 50, durationMs: 50, isPlatform: false },
    ];
    const { container } = render(<TraceWaterfall segments={segments} />);

    const bars = container.querySelectorAll(".trace-bar");
    // Total is 100ms; second segment starts halfway through.
    expect((bars[0] as HTMLElement).style.marginLeft).toBe("0%");
    expect((bars[1] as HTMLElement).style.marginLeft).toBe("50%");
  });

  it("gives a very short segment a minimum visible width", () => {
    const segments: TraceSegment[] = [
      { id: "1", parentId: null, name: "Tiny", startOffsetMs: 0, durationMs: 1, isPlatform: false },
      { id: "2", parentId: null, name: "Long", startOffsetMs: 0, durationMs: 1000, isPlatform: false },
    ];
    const { container } = render(<TraceWaterfall segments={segments} />);

    const bars = container.querySelectorAll(".trace-bar");
    // 1/1000 * 100 = 0.1%, floored up to the 0.6% minimum.
    expect((bars[0] as HTMLElement).style.width).toBe("0.6%");
  });

  it("nests child segments under their parent via id/parentId, indented and ordered by start time", () => {
    const segments: TraceSegment[] = [
      { id: "lambda", parentId: null, name: "Lambda", startOffsetMs: 0, durationMs: 100, isPlatform: true },
      {
        id: "anthropic",
        parentId: "lambda",
        name: "Anthropic API",
        startOffsetMs: 20,
        durationMs: 60,
        isPlatform: false,
      },
      {
        id: "dynamo",
        parentId: "lambda",
        name: "DynamoDB",
        startOffsetMs: 5,
        durationMs: 10,
        isPlatform: false,
      },
    ];
    const { container } = render(<TraceWaterfall segments={segments} />);

    const rows = container.querySelectorAll(".trace-row");
    expect(rows).toHaveLength(3);
    // Root first, then children ordered by startOffsetMs (dynamo at 5 before anthropic at 20),
    // regardless of the input array's order.
    expect(rows[0].querySelector(".trace-label-text")?.textContent).toBe("Lambda");
    expect(rows[1].querySelector(".trace-label-text")?.textContent).toBe("DynamoDB");
    expect(rows[2].querySelector(".trace-label-text")?.textContent).toBe("Anthropic API");

    const rootLabel = rows[0].querySelector(".trace-label") as HTMLElement;
    const childLabel = rows[1].querySelector(".trace-label") as HTMLElement;
    expect(rootLabel.style.paddingLeft).toBe("0rem");
    expect(childLabel.style.paddingLeft).toBe("1.1rem");
  });

  it("collapses a parent's children on toggle click, showing a descendant count, and expands again on a second click", () => {
    const segments: TraceSegment[] = [
      { id: "lambda", parentId: null, name: "Lambda", startOffsetMs: 0, durationMs: 100, isPlatform: true },
      {
        id: "anthropic",
        parentId: "lambda",
        name: "Anthropic API",
        startOffsetMs: 20,
        durationMs: 60,
        isPlatform: false,
      },
    ];
    const { container } = render(<TraceWaterfall segments={segments} />);

    expect(container.querySelectorAll(".trace-row")).toHaveLength(2);

    const toggle = container.querySelector(".trace-toggle") as HTMLButtonElement;
    fireEvent.click(toggle);

    const collapsedRows = container.querySelectorAll(".trace-row");
    expect(collapsedRows).toHaveLength(1);
    expect(collapsedRows[0].querySelector(".trace-child-count")?.textContent).toBe("+1");

    fireEvent.click(toggle);
    expect(container.querySelectorAll(".trace-row")).toHaveLength(2);
  });

  it("treats a segment whose parentId doesn't match any segment in the list as a root", () => {
    const segments: TraceSegment[] = [
      {
        id: "orphan",
        parentId: "missing-parent",
        name: "Orphan",
        startOffsetMs: 0,
        durationMs: 10,
        isPlatform: false,
      },
    ];
    const { container } = render(<TraceWaterfall segments={segments} />);

    expect(container.querySelectorAll(".trace-row")).toHaveLength(1);
    expect(container.querySelector(".trace-label-text")?.textContent).toBe("Orphan");
  });
});
