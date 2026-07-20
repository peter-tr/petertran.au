import { describe, expect, it } from "vitest";
import { checkSufficiency, scaleAmount, scalePrice } from "./recipeScaling";

describe("scaleAmount", () => {
  it("scales the leading number by the ratio, keeping the trailing unit text", () => {
    expect(scaleAmount("2.5 cups", 2.5, 2)).toBe("5 cups");
  });

  it("returns the original text unchanged when quantity is 0 (unscalable, e.g. 'to taste')", () => {
    expect(scaleAmount("to taste", 0, 2)).toBe("to taste");
  });

  it("returns the original text unchanged when ratio is exactly 1 (no scaling needed)", () => {
    expect(scaleAmount("2 cups", 2, 1)).toBe("2 cups");
  });

  it("returns null unchanged when amount is null", () => {
    expect(scaleAmount(null, 2, 2)).toBeNull();
  });

  it("returns the original text unchanged when quantity is negative", () => {
    expect(scaleAmount("-1 cups", -1, 2)).toBe("-1 cups");
  });

  it("trims floating point noise from the scaled result", () => {
    // 0.1 * 3 in floating point is 0.30000000000000004
    expect(scaleAmount("0.1 tsp", 0.1, 3)).toBe("0.3 tsp");
  });

  it("drops a trailing .0 so scaled amounts read like something a person would type", () => {
    expect(scaleAmount("1 cup", 1, 2)).toBe("2 cup");
  });

  it("handles an amount with no unit at all (bare number)", () => {
    expect(scaleAmount("3", 3, 2)).toBe("6");
  });

  it("scales down (ratio < 1) as well as up", () => {
    expect(scaleAmount("4 cups", 4, 0.5)).toBe("2 cups");
  });

  it("rounds to 2 decimal places for a non-clean multiplication", () => {
    expect(scaleAmount("1 cup", 1, 1 / 3)).toBe("0.33 cup");
  });
});

describe("scalePrice", () => {
  it("scales the price by ratio when the ingredient's amount is cleanly scalable", () => {
    expect(scalePrice(10, 2, 2)).toBe(20);
  });

  it("leaves the price unchanged when quantity is 0 (not scalable)", () => {
    expect(scalePrice(10, 0, 2)).toBe(10);
  });

  it("leaves the price unchanged when quantity is negative", () => {
    expect(scalePrice(10, -1, 2)).toBe(10);
  });

  it("scales down correctly", () => {
    expect(scalePrice(10, 4, 0.5)).toBe(5);
  });
});

describe("checkSufficiency", () => {
  it("returns 'unknown' when amount is null", () => {
    expect(checkSufficiency(null, 0, 1, { quantity: 100, unit: "g" })).toBe("unknown");
  });

  it("returns 'unknown' when quantity is 0 (e.g. 'a pinch', not cleanly scalable)", () => {
    expect(checkSufficiency("a pinch", 0, 1, { quantity: 100, unit: "g" })).toBe("unknown");
  });

  it("returns 'unknown' when there's no matched inventory item", () => {
    expect(checkSufficiency("500g", 500, 1, null)).toBe("unknown");
  });

  it("returns 'unknown' when units are different kinds of things (mass vs volume)", () => {
    expect(checkSufficiency("5600g", 5600, 1, { quantity: 1000, unit: "mL" })).toBe("unknown");
  });

  it("returns 'sufficient' when inventory has at least the scaled requirement, same unit", () => {
    expect(checkSufficiency("200g", 200, 1, { quantity: 500, unit: "g" })).toBe("sufficient");
  });

  it("returns 'insufficient' when inventory has less than the scaled requirement", () => {
    expect(checkSufficiency("200g", 200, 1, { quantity: 100, unit: "g" })).toBe("insufficient");
  });

  it("returns 'sufficient' exactly at the boundary (have == need)", () => {
    expect(checkSufficiency("200g", 200, 1, { quantity: 200, unit: "g" })).toBe("sufficient");
  });

  it("converts mass units to a common base (kg recipe vs g inventory)", () => {
    expect(checkSufficiency("1kg", 1, 1, { quantity: 500, unit: "g" })).toBe("insufficient");
    expect(checkSufficiency("1kg", 1, 1, { quantity: 1500, unit: "g" })).toBe("sufficient");
  });

  it("converts volume units to a common base (cups recipe vs mL inventory)", () => {
    // 2 cups = 500mL
    expect(checkSufficiency("2 cups", 2, 1, { quantity: 400, unit: "mL" })).toBe("insufficient");
    expect(checkSufficiency("2 cups", 2, 1, { quantity: 600, unit: "mL" })).toBe("sufficient");
  });

  it("scales the requirement by the servings ratio before comparing", () => {
    // 2 servings -> 4 servings is ratio 2, so 200g becomes 400g needed
    expect(checkSufficiency("200g", 200, 2, { quantity: 300, unit: "g" })).toBe("insufficient");
    expect(checkSufficiency("200g", 200, 2, { quantity: 500, unit: "g" })).toBe("sufficient");
  });

  it("treats an unrecognized/missing inventory unit as a count", () => {
    expect(checkSufficiency("3", 3, 1, { quantity: 5, unit: null })).toBe("sufficient");
    expect(checkSufficiency("3", 3, 1, { quantity: 2, unit: null })).toBe("insufficient");
  });

  it("treats non-mass/volume units (pack, box, large, cloves) as counts, comparable to each other", () => {
    expect(checkSufficiency("2 cloves", 2, 1, { quantity: 5, unit: "cloves" })).toBe("sufficient");
    expect(checkSufficiency("14 large", 14, 1, { quantity: 6, unit: "pcs" })).toBe("insufficient");
  });

  it("expands dozen/doz to 12 units for count comparisons", () => {
    expect(checkSufficiency("1 dozen", 1, 1, { quantity: 12, unit: "pcs" })).toBe("sufficient");
    expect(checkSufficiency("1 dozen", 1, 1, { quantity: 6, unit: "pcs" })).toBe("insufficient");
  });
});
