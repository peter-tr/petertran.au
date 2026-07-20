import { describe, it, expect } from "vitest";
import { normalizePath } from "./http";

describe("normalizePath", () => {
  it("leaves a single-slash path unchanged", () => {
    expect(normalizePath("/introspect")).toBe("/introspect");
  });

  it("collapses a doubled leading slash", () => {
    expect(normalizePath("//introspect")).toBe("/introspect");
  });

  it("collapses repeated slashes anywhere in the path, not just the start", () => {
    expect(normalizePath("/domain-a//foo///bar")).toBe("/domain-a/foo/bar");
  });

  it("collapses a long run of slashes to one", () => {
    expect(normalizePath("/////")).toBe("/");
  });

  it("passes through the root path unchanged", () => {
    expect(normalizePath("/")).toBe("/");
  });

  it("passes through a path with no repeated slashes unchanged", () => {
    expect(normalizePath("/.well-known/jwks.json")).toBe("/.well-known/jwks.json");
  });
});
