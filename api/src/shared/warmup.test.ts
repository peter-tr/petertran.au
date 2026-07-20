import { describe, expect, it } from "vitest";
import { isWarmupPing } from "./warmup";

describe("isWarmupPing", () => {
  it("recognizes the canonical warmup payload", () => {
    expect(isWarmupPing({ warmup: true })).toBe(true);
  });

  it("recognizes the warmup payload alongside extra fields", () => {
    expect(isWarmupPing({ warmup: true, requestContext: {}, extra: 1 })).toBe(true);
  });

  it("rejects warmup: false", () => {
    expect(isWarmupPing({ warmup: false })).toBe(false);
  });

  it("rejects a truthy but non-boolean warmup value", () => {
    expect(isWarmupPing({ warmup: "true" })).toBe(false);
    expect(isWarmupPing({ warmup: 1 })).toBe(false);
  });

  it("rejects an object missing the warmup key", () => {
    expect(isWarmupPing({})).toBe(false);
    expect(isWarmupPing({ body: "{}" })).toBe(false);
  });

  it("rejects null and undefined", () => {
    expect(isWarmupPing(null)).toBe(false);
    expect(isWarmupPing(undefined)).toBe(false);
  });

  it("rejects non-object primitives", () => {
    expect(isWarmupPing("warmup")).toBe(false);
    expect(isWarmupPing(42)).toBe(false);
    expect(isWarmupPing(true)).toBe(false);
  });

  it("rejects arrays even though typeof is object", () => {
    expect(isWarmupPing([])).toBe(false);
    expect(isWarmupPing([{ warmup: true }])).toBe(false);
  });
});
