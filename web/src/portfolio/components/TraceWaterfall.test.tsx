import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
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
      { name: "Lambda: handler", startOffsetMs: 0, durationMs: 120, isPlatform: true },
      { name: "DynamoDB: GetItem", startOffsetMs: 10, durationMs: 30, isPlatform: false },
      { name: "Anthropic: messages.create", startOffsetMs: 40, durationMs: 900, isPlatform: false },
    ];
    const { container } = render(<TraceWaterfall segments={segments} />);

    const rows = container.querySelectorAll(".trace-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector(".trace-label")?.textContent).toBe("Lambda: handler");
    expect(rows[0].querySelector(".trace-duration")?.textContent).toBe("120ms");
  });

  it("colors bars by segment kind (Lambda/DynamoDB/Anthropic/other)", () => {
    const segments: TraceSegment[] = [
      { name: "Lambda: handler", startOffsetMs: 0, durationMs: 10, isPlatform: true },
      { name: "DynamoDB: GetItem", startOffsetMs: 0, durationMs: 10, isPlatform: false },
      { name: "Anthropic: messages.create", startOffsetMs: 0, durationMs: 10, isPlatform: false },
      { name: "Something else", startOffsetMs: 0, durationMs: 10, isPlatform: false },
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
      { name: "First", startOffsetMs: 0, durationMs: 50, isPlatform: false },
      { name: "Second", startOffsetMs: 50, durationMs: 50, isPlatform: false },
    ];
    const { container } = render(<TraceWaterfall segments={segments} />);

    const bars = container.querySelectorAll(".trace-bar");
    // Total is 100ms; second segment starts halfway through.
    expect((bars[0] as HTMLElement).style.marginLeft).toBe("0%");
    expect((bars[1] as HTMLElement).style.marginLeft).toBe("50%");
  });

  it("gives a very short segment a minimum visible width", () => {
    const segments: TraceSegment[] = [
      { name: "Tiny", startOffsetMs: 0, durationMs: 1, isPlatform: false },
      { name: "Long", startOffsetMs: 0, durationMs: 1000, isPlatform: false },
    ];
    const { container } = render(<TraceWaterfall segments={segments} />);

    const bars = container.querySelectorAll(".trace-bar");
    // 1/1000 * 100 = 0.1%, floored up to the 0.6% minimum.
    expect((bars[0] as HTMLElement).style.width).toBe("0.6%");
  });
});
