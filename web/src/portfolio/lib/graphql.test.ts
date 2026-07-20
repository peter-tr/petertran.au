import { describe, it, expect } from "vitest";
import {
  ENDPOINT,
  RESUME_QUERY,
  HERO_QUERY,
  SEND_MESSAGE_MUTATION,
  GENERATE_QUERY_QUERY,
  SYSTEM_STATS_QUERY,
  TRACE_BREAKDOWN_QUERY,
  FOOTER_QUERY,
} from "./graphql";

// graphqlClient's withOperationName relies on every query/mutation being
// named (query/mutation Foo { ... }) so it can append ?opname=Foo for
// observability - see web/src/shared/graphqlClient.ts. A query here that
// regresses to an anonymous op would silently lose that instrumentation.
const NAMED_OPERATION_PATTERN = /^\s*(?:query|mutation|subscription)\s+([A-Za-z_]\w*)/;

describe("portfolio graphql query constants", () => {
  it.each([
    ["RESUME_QUERY", RESUME_QUERY, "Resume"],
    ["HERO_QUERY", HERO_QUERY, "Hero"],
    ["SEND_MESSAGE_MUTATION", SEND_MESSAGE_MUTATION, "SendMessage"],
    ["GENERATE_QUERY_QUERY", GENERATE_QUERY_QUERY, "GenerateQuery"],
    ["SYSTEM_STATS_QUERY", SYSTEM_STATS_QUERY, "SystemStats"],
    ["TRACE_BREAKDOWN_QUERY", TRACE_BREAKDOWN_QUERY, "TraceBreakdown"],
    ["FOOTER_QUERY", FOOTER_QUERY, "Footer"],
  ])("%s is a named operation called %s", (_label, query, expectedName) => {
    const match = NAMED_OPERATION_PATTERN.exec(query);
    expect(match?.[1]).toBe(expectedName);
  });

  it("reads the GraphQL endpoint from VITE_GRAPHQL_ENDPOINT", () => {
    expect(ENDPOINT).toBe("https://api.test.petertran.au/portfolio");
  });
});
