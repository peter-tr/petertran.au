import { describe, it, expect } from "vitest";
import { formatMonth, formatRange } from "./format";

describe("formatMonth", () => {
  it("returns 'Present' for null", () => {
    expect(formatMonth(null)).toBe("Present");
  });

  it("formats a YYYY-MM string into 'Mon YYYY'", () => {
    expect(formatMonth("2024-01")).toBe("Jan 2024");
    expect(formatMonth("2024-12")).toBe("Dec 2024");
  });

  it("falls back to the raw month number if it's out of range", () => {
    expect(formatMonth("2024-13")).toBe("13 2024");
  });
});

describe("formatRange", () => {
  it("joins a start and end month with an em dash", () => {
    expect(formatRange("2020-01", "2022-06")).toBe("Jan 2020 — Jun 2022");
  });

  it("uses 'Present' for an open-ended range", () => {
    expect(formatRange("2023-03", null)).toBe("Mar 2023 — Present");
  });
});
