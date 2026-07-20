import { describe, it, expect } from "vitest";
import { generateOpaqueToken } from "./opaque-token";

describe("generateOpaqueToken", () => {
  it("returns a base64url string with no padding characters", () => {
    const token = generateOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain("=");
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
  });

  it("encodes 32 random bytes (43 base64url characters, unpadded)", () => {
    const token = generateOpaqueToken();
    expect(token.length).toBe(43);
  });

  it("generates a different token on each call", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
  });
});
