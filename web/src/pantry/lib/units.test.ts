import { describe, expect, it } from "vitest";
import { UNIT_OPTIONS, stepForUnit } from "./units";

describe("UNIT_OPTIONS", () => {
  it("includes every canonical unit the backend's normalizeUnit table recognizes", () => {
    expect(UNIT_OPTIONS).toEqual([
      "pcs",
      "g",
      "kg",
      "mg",
      "L",
      "mL",
      "pack",
      "box",
      "bottle",
      "can",
      "bag",
      "dozen",
    ]);
  });

  it("has no duplicates", () => {
    expect(new Set(UNIT_OPTIONS).size).toBe(UNIT_OPTIONS.length);
  });
});

describe("stepForUnit", () => {
  it("steps by 100 for grams", () => {
    expect(stepForUnit("g")).toBe(100);
  });

  it("steps by 100 for millilitres", () => {
    expect(stepForUnit("mL")).toBe(100);
  });

  it("steps by 1 for other units like pcs", () => {
    expect(stepForUnit("pcs")).toBe(1);
  });

  it("steps by 1 for kg/L, since only the small-unit forms are bought in bulk", () => {
    expect(stepForUnit("kg")).toBe(1);
    expect(stepForUnit("L")).toBe(1);
  });

  it("is case sensitive - lowercase 'ml' does not match 'mL'", () => {
    expect(stepForUnit("ml")).toBe(1);
  });

  it("steps by 1 when unit is null or undefined", () => {
    expect(stepForUnit(null)).toBe(1);
    expect(stepForUnit(undefined)).toBe(1);
  });

  it("steps by 1 for an empty string", () => {
    expect(stepForUnit("")).toBe(1);
  });
});
