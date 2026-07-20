import { describe, expect, it } from "vitest";
import { colesLinkFor, formatDebugInfo, formatLastKnownPrice } from "./priceDisplay";
import type { AiCallDebugInfo, LastKnownPrice } from "../api";

function makePrice(overrides: Partial<LastKnownPrice> = {}): LastKnownPrice {
  return {
    colesPrice: 4.5,
    productUrl: null,
    note: null,
    checkedAt: "2026-07-01T00:00:00.000Z",
    debugInfo: { costUsd: 0.01, durationMs: 1000, searchesUsed: 0, fetchesUsed: 0 },
    ...overrides,
  };
}

describe("formatLastKnownPrice", () => {
  it("shows 'pending' when no price check has happened yet", () => {
    expect(formatLastKnownPrice(null)).toBe("price check pending");
  });

  it("shows '$ N/A' when the price half was blocked/location-gated", () => {
    expect(formatLastKnownPrice(makePrice({ colesPrice: null }))).toBe("$ N/A");
  });

  it("formats a plain confirmed price with two decimals, no note prefix", () => {
    expect(formatLastKnownPrice(makePrice({ colesPrice: 4.5 }))).toBe("$4.50");
  });

  it("prefixes with '~' when the price came with a caveat note", () => {
    expect(formatLastKnownPrice(makePrice({ colesPrice: 4.5, note: "approx, different pack size" }))).toBe(
      "~$4.50"
    );
  });

  it("rounds to two decimal places", () => {
    expect(formatLastKnownPrice(makePrice({ colesPrice: 3.999 }))).toBe("$4.00");
  });

  it("never shows a 'Coles' prefix (Woolworths is never shown either)", () => {
    const formatted = formatLastKnownPrice(makePrice({ colesPrice: 4.5, note: "note" }));
    expect(formatted).not.toContain("Coles");
    expect(formatted).not.toContain("Woolworths");
  });
});

describe("colesLinkFor", () => {
  it("returns null when there's no price check at all", () => {
    expect(colesLinkFor("milk", null)).toBeNull();
  });

  it("prefers the confirmed product URL when present", () => {
    expect(colesLinkFor("milk", makePrice({ productUrl: "https://www.coles.com.au/product/milk-123" }))).toBe(
      "https://www.coles.com.au/product/milk-123"
    );
  });

  it("falls back to a search link when there's a confirmed price but no product page", () => {
    expect(colesLinkFor("milk", makePrice({ productUrl: null, colesPrice: 4.5 }))).toBe(
      "https://www.coles.com.au/search?q=milk"
    );
  });

  it("URL-encodes the item name in the search fallback", () => {
    expect(colesLinkFor("free range eggs & bacon", makePrice({ productUrl: null, colesPrice: 4.5 }))).toBe(
      "https://www.coles.com.au/search?q=free%20range%20eggs%20%26%20bacon"
    );
  });

  it("returns null when neither a product page nor a confirmed price exist (no match)", () => {
    expect(colesLinkFor("milk", makePrice({ productUrl: null, colesPrice: null }))).toBeNull();
  });
});

describe("formatDebugInfo", () => {
  function makeDebugInfo(overrides: Partial<AiCallDebugInfo> = {}): AiCallDebugInfo {
    return { costUsd: 0.0123, durationMs: 4200, searchesUsed: 0, fetchesUsed: 0, ...overrides };
  }

  it("always shows cost and duration", () => {
    expect(formatDebugInfo(makeDebugInfo())).toBe("$0.0123 · 4.2s");
  });

  it("omits searches/fetches counts when zero", () => {
    const formatted = formatDebugInfo(makeDebugInfo({ searchesUsed: 0, fetchesUsed: 0 }));
    expect(formatted).not.toContain("search");
    expect(formatted).not.toContain("fetch");
  });

  it("pluralizes 'searches' for counts other than 1", () => {
    expect(formatDebugInfo(makeDebugInfo({ searchesUsed: 3 }))).toContain("3 searches");
  });

  it("keeps 'search' singular for exactly 1", () => {
    expect(formatDebugInfo(makeDebugInfo({ searchesUsed: 1 }))).toContain("1 search");
    expect(formatDebugInfo(makeDebugInfo({ searchesUsed: 1 }))).not.toContain("1 searches");
  });

  it("pluralizes 'fetches' for counts other than 1, singular for exactly 1", () => {
    expect(formatDebugInfo(makeDebugInfo({ fetchesUsed: 2 }))).toContain("2 fetches");
    expect(formatDebugInfo(makeDebugInfo({ fetchesUsed: 1 }))).toContain("1 fetch");
    expect(formatDebugInfo(makeDebugInfo({ fetchesUsed: 1 }))).not.toContain("1 fetches");
  });

  it("shows both searches and fetches together when both were used", () => {
    expect(formatDebugInfo(makeDebugInfo({ searchesUsed: 2, fetchesUsed: 1 }))).toBe(
      "$0.0123 · 4.2s · 2 searches · 1 fetch"
    );
  });
});
