import { describe, expect, it } from "vitest";
import { WORD_CATEGORIES, findWordCategory, randomPair } from "./words";

describe("findWordCategory", () => {
  it("finds a category by its id", () => {
    expect(findWordCategory("animals")?.label).toBe("Animals");
    expect(findWordCategory("food-drink")?.label).toBe("Food & Drink");
  });

  it("returns undefined for an unknown id", () => {
    expect(findWordCategory("not-a-real-category")).toBeUndefined();
  });
});

describe("randomPair", () => {
  const cases = WORD_CATEGORIES.map((c) => [c.id, c] as const);

  it.each(cases)("always returns one of %s's normalPairs on NORMAL difficulty", (_id, category) => {
    for (let i = 0; i < 50; i++) {
      const pair = randomPair(category, "NORMAL");
      expect(category.normalPairs).toContainEqual(pair);
    }
  });

  it.each(cases)("always returns one of %s's hardPairs on HARD difficulty", (_id, category) => {
    for (let i = 0; i < 50; i++) {
      const pair = randomPair(category, "HARD");
      expect(category.hardPairs).toContainEqual(pair);
    }
  });
});

describe("WORD_CATEGORIES", () => {
  it("has unique category ids", () => {
    const ids = WORD_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never pairs a word with itself, in either tier of any category", () => {
    for (const category of WORD_CATEGORIES) {
      for (const pair of [...category.normalPairs, ...category.hardPairs]) {
        expect(pair.civilian.toLowerCase()).not.toBe(pair.imposter.toLowerCase());
      }
    }
  });

  it("gives every category at least one pair in each difficulty tier", () => {
    for (const category of WORD_CATEGORIES) {
      expect(category.normalPairs.length).toBeGreaterThan(0);
      expect(category.hardPairs.length).toBeGreaterThan(0);
    }
  });
});
