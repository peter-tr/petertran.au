import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { daysBetween, formatPurchasedAt, formatExpiresAt } from "./dates";

describe("dates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T12:34:56"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("daysBetween", () => {
    it("returns 0 for today", () => {
      expect(daysBetween("2026-07-20")).toBe(0);
    });

    it("returns a positive number for a future date", () => {
      expect(daysBetween("2026-07-25")).toBe(5);
    });

    it("returns a negative number for a past date", () => {
      expect(daysBetween("2026-07-15")).toBe(-5);
    });
  });

  describe("formatPurchasedAt", () => {
    it("returns 'today' when purchased today", () => {
      expect(formatPurchasedAt("2026-07-20")).toBe("today");
    });

    it("returns 'today' when the date is somehow in the future", () => {
      expect(formatPurchasedAt("2026-07-25")).toBe("today");
    });

    it("returns 'Nd ago' for a past date", () => {
      expect(formatPurchasedAt("2026-07-11")).toBe("9d ago");
    });
  });

  describe("formatExpiresAt", () => {
    it("returns 'expires today' for today", () => {
      expect(formatExpiresAt("2026-07-20")).toBe("expires today");
    });

    it("returns 'expires in Nd' for a future date", () => {
      expect(formatExpiresAt("2026-07-27")).toBe("expires in 7d");
    });

    it("returns 'expired Nd ago' for a past date", () => {
      expect(formatExpiresAt("2026-07-13")).toBe("expired 7d ago");
    });
  });
});
