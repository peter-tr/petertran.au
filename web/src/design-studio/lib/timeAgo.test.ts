import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { formatEditedAgo } from "./timeAgo";

describe("formatEditedAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for under a minute", () => {
    expect(formatEditedAgo("2026-07-27T11:59:30Z")).toBe("just now");
  });

  it("returns minutes for under an hour", () => {
    expect(formatEditedAgo("2026-07-27T11:45:00Z")).toBe("15m ago");
  });

  it("returns hours for under a day", () => {
    expect(formatEditedAgo("2026-07-27T09:00:00Z")).toBe("3h ago");
  });

  it("returns days for under a week", () => {
    expect(formatEditedAgo("2026-07-24T12:00:00Z")).toBe("3d ago");
  });

  it("returns weeks for under 5 weeks", () => {
    expect(formatEditedAgo("2026-07-06T12:00:00Z")).toBe("3w ago");
  });

  it("returns months for under a year", () => {
    expect(formatEditedAgo("2026-04-27T12:00:00Z")).toBe("3mo ago");
  });

  it("returns years for over a year", () => {
    expect(formatEditedAgo("2024-07-27T12:00:00Z")).toBe("2y ago");
  });
});
