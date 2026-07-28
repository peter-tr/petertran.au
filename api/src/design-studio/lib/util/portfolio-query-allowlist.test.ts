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

  it.each([
    {
      description: "rejects a mutation",
      query: 'mutation { sendMessage(input: { name: "x" }) { ok } }',
      expectedReasonSubstring: '"mutation"',
    },
    {
      description: "rejects a subscription",
      query: "subscription { person { name } }",
      expectedReasonSubstring: '"subscription"',
    },
    {
      description: "rejects the meta field",
      query: "{ meta { systemStats { uptime } } }",
      expectedReasonSubstring: '"meta"',
    },
    {
      description: "rejects the _service introspection field",
      query: "{ _service { sdl } }",
      expectedReasonSubstring: "_service",
    },
    {
      description: "rejects a field not in the portfolio allowlist",
      query: "{ inventory { name } }",
      expectedReasonSubstring: '"inventory"',
    },
    {
      description: "rejects invalid GraphQL syntax",
      query: "{ person { ",
      expectedReasonSubstring: "Not valid GraphQL",
    },
    {
      description: "rejects a document with more than one operation",
      query: "query A { person { name } } query B { projects { name } }",
      expectedReasonSubstring: "exactly one operation",
    },
    {
      description: "rejects a fragment spread at the root selection set",
      query: "{ ...PersonFields } fragment PersonFields on Query { person { name } }",
      expectedReasonSubstring: "Fragments are not allowed",
    },
  ])("$description", ({ query, expectedReasonSubstring }) => {
    const result = validatePortfolioQuery(query);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(expectedReasonSubstring);
  });
});
