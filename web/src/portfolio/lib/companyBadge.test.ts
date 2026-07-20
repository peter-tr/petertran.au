import { describe, it, expect } from "vitest";
import { companyInitials, companyAccent } from "./companyBadge";

describe("companyInitials", () => {
  it("takes the first letter of up to 3 significant words", () => {
    expect(companyInitials("Commonwealth Bank of Australia")).toBe("CBA");
  });

  it("filters out stopwords like 'of', 'and', 'the', '&'", () => {
    expect(companyInitials("Services & Corp of the Realm")).toBe("SCR");
  });

  it("caps at 3 initials even with more significant words", () => {
    expect(companyInitials("Alpha Beta Gamma Delta Epsilon")).toBe("ABG");
  });

  it("handles a single word", () => {
    expect(companyInitials("Boeing")).toBe("B");
  });

  it("uppercases initials regardless of input case", () => {
    expect(companyInitials("university of queensland")).toBe("UQ");
  });
});

describe("companyAccent", () => {
  const ACCENT_VARS = ["var(--signal)", "var(--type)", "var(--string)"];

  it("returns one of the known accent CSS vars", () => {
    expect(ACCENT_VARS).toContain(companyAccent("Some Company"));
  });

  it("is deterministic for the same input", () => {
    expect(companyAccent("Australian Defence Force")).toBe(companyAccent("Australian Defence Force"));
  });

  it("can produce different accents for different names", () => {
    // Not guaranteed for every pair, but these two land on different sums.
    expect(companyAccent("A")).not.toBe(companyAccent("AA"));
  });
});
