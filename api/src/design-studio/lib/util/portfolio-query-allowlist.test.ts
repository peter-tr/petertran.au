import { describe, expect, it } from "vitest";
import { validatePortfolioQuery } from "./portfolio-query-allowlist";

describe("validatePortfolioQuery", () => {
  it("accepts a single allowed root field", () => {
    expect(validatePortfolioQuery("{ person { name } }")).toEqual({ ok: true });
  });

  it("accepts multiple allowed root fields in one query", () => {
    expect(validatePortfolioQuery("{ person { name } projects { name } skills { category } }")).toEqual({
      ok: true,
    });
  });

  it("accepts an explicit query operation with arguments", () => {
    expect(validatePortfolioQuery("query { experience(currentOnly: true) { title } }")).toEqual({
      ok: true,
    });
  });

  it("rejects a mutation", () => {
    const result = validatePortfolioQuery('mutation { sendMessage(input: { name: "x" }) { ok } }');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('"mutation"');
  });

  it("rejects a subscription", () => {
    const result = validatePortfolioQuery("subscription { person { name } }");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('"subscription"');
  });

  it("rejects the meta field", () => {
    const result = validatePortfolioQuery("{ meta { systemStats { uptime } } }");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('"meta"');
  });

  it("rejects the _service introspection field", () => {
    const result = validatePortfolioQuery("{ _service { sdl } }");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("_service");
  });

  it("rejects a field not in the portfolio allowlist", () => {
    const result = validatePortfolioQuery("{ inventory { name } }");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('"inventory"');
  });

  it("rejects invalid GraphQL syntax", () => {
    const result = validatePortfolioQuery("{ person { ");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Not valid GraphQL");
  });

  it("rejects a document with more than one operation", () => {
    const result = validatePortfolioQuery("query A { person { name } } query B { projects { name } }");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("exactly one operation");
  });

  it("rejects a fragment spread at the root selection set", () => {
    const result = validatePortfolioQuery(
      "{ ...PersonFields } fragment PersonFields on Query { person { name } }"
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Fragments are not allowed");
  });
});
