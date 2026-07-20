import { describe, it, expect, vi, afterEach } from "vitest";
import { formatWhen } from "./format";

describe("formatWhen", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delegates to Date#toLocaleString with month/day/hour/minute formatting options", () => {
    const spy = vi.spyOn(Date.prototype, "toLocaleString").mockReturnValue("Mar 5, 2:30 PM");

    const result = formatWhen("2026-03-05T14:30:00Z");

    expect(spy).toHaveBeenCalledWith(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    expect(result).toBe("Mar 5, 2:30 PM");
  });

  it("formats a known ISO timestamp using this environment's locale/timezone (en-US/UTC)", () => {
    // This environment resolves to en-US/UTC (verified in the sandbox this
    // suite runs in), so we can assert the literal output rather than only
    // asserting the delegation above.
    expect(formatWhen("2026-03-05T14:30:00Z")).toBe("Mar 5, 2:30 PM");
  });

  it("pads single-digit minutes to two digits", () => {
    expect(formatWhen("2026-01-01T00:05:00Z")).toBe("Jan 1, 12:05 AM");
  });

  it("produces different output for different instants", () => {
    const a = formatWhen("2026-01-01T00:00:00Z");
    const b = formatWhen("2026-12-25T23:59:00Z");

    expect(a).not.toBe(b);
  });
});
