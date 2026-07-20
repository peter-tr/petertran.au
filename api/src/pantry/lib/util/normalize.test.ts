import { describe, expect, it } from "vitest";
import { normalizeItemName, normalizeUnit } from "./normalize";

describe("normalizeItemName", () => {
  it("lowercases and trims", () => {
    expect(normalizeItemName("  Milk  ")).toBe("milk");
  });

  it("collapses internal whitespace runs to a single space", () => {
    expect(normalizeItemName("greek   yoghurt")).toBe("greek yoghurt");
  });

  it("strips a plain trailing s", () => {
    expect(normalizeItemName("eggs")).toBe("egg");
    expect(normalizeItemName("Eggs")).toBe("egg");
  });

  it("does not strip a trailing double-s (ss)", () => {
    expect(normalizeItemName("glass")).toBe("glass");
    expect(normalizeItemName("GLASS")).toBe("glass");
  });

  it("strips es after s/x/z/ch/sh", () => {
    expect(normalizeItemName("boxes")).toBe("box");
    expect(normalizeItemName("buzzes")).toBe("buzz");
    expect(normalizeItemName("churches")).toBe("church");
    expect(normalizeItemName("dishes")).toBe("dish");
    expect(normalizeItemName("glasses")).toBe("glass");
  });

  it("only strips the trailing s (not es) when the char before es doesn't match s/x/z/ch/sh", () => {
    // "tomatoes" ends in "toes" - 't' isn't one of s/x/z/ch/sh, so the
    // es-stripping branch doesn't apply here; only the plain trailing-s
    // branch does. This is a known limitation of the crude heuristic (see
    // the file's top-of-file comment), not a bug to "fix" in the test.
    expect(normalizeItemName("tomatoes")).toBe("tomatoe");
  });

  it("converts a consonant + ies ending to y", () => {
    expect(normalizeItemName("berries")).toBe("berry");
    expect(normalizeItemName("cherries")).toBe("cherry");
  });

  it("does not convert ies to y when a vowel precedes ies (only strips the trailing s)", () => {
    // /[^aeiou]ies$/ requires a non-vowel right before "ies" - when a vowel
    // precedes it, this falls through to the plain trailing-s branch instead.
    expect(normalizeItemName("zoies")).toBe("zoie");
  });

  it("leaves a singular word alone", () => {
    expect(normalizeItemName("Butter")).toBe("butter");
  });

  it("leaves an empty string alone", () => {
    expect(normalizeItemName("")).toBe("");
  });
});

describe("normalizeUnit", () => {
  it("returns null for null/undefined/empty/whitespace-only input", () => {
    expect(normalizeUnit(null)).toBeNull();
    expect(normalizeUnit(undefined)).toBeNull();
    expect(normalizeUnit("")).toBeNull();
    expect(normalizeUnit("   ")).toBeNull();
  });

  it("canonicalizes known aliases regardless of case/whitespace", () => {
    expect(normalizeUnit("g")).toBe("g");
    expect(normalizeUnit("gram")).toBe("g");
    expect(normalizeUnit("Grams")).toBe("g");
    expect(normalizeUnit(" grams ")).toBe("g");
    expect(normalizeUnit("kg")).toBe("kg");
    expect(normalizeUnit("kilograms")).toBe("kg");
    expect(normalizeUnit("mg")).toBe("mg");
    expect(normalizeUnit("milligrams")).toBe("mg");
    expect(normalizeUnit("l")).toBe("L");
    expect(normalizeUnit("liter")).toBe("L");
    expect(normalizeUnit("litres")).toBe("L");
    expect(normalizeUnit("ml")).toBe("mL");
    expect(normalizeUnit("millilitres")).toBe("mL");
    expect(normalizeUnit("pc")).toBe("pcs");
    expect(normalizeUnit("piece")).toBe("pcs");
    expect(normalizeUnit("pieces")).toBe("pcs");
    expect(normalizeUnit("pk")).toBe("pack");
    expect(normalizeUnit("packs")).toBe("pack");
    expect(normalizeUnit("boxes")).toBe("box");
    expect(normalizeUnit("bottles")).toBe("bottle");
    expect(normalizeUnit("cans")).toBe("can");
    expect(normalizeUnit("bags")).toBe("bag");
    expect(normalizeUnit("doz")).toBe("dozen");
  });

  it("falls back to the trimmed original for an unrecognized unit", () => {
    expect(normalizeUnit("sheets")).toBe("sheets");
    expect(normalizeUnit("  sheets  ")).toBe("sheets");
  });

  it("preserves case for an unrecognized unit (only trims)", () => {
    expect(normalizeUnit("Sheets")).toBe("Sheets");
  });
});
