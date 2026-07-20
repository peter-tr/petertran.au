import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGraphQLClient, GraphQLRequestError } from "./graphqlClient";

const { recordRumError } = vi.hoisted(() => ({ recordRumError: vi.fn() }));
vi.mock("./rum", () => ({ recordRumError }));

describe("createGraphQLClient", () => {
  beforeEach(() => {
    recordRumError.mockClear();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("throws without hitting the network when no endpoint is configured", async () => {
    const runQuery = createGraphQLClient(undefined, "VITE_SOME_ENDPOINT");

    await expect(runQuery("query Foo { foo }")).rejects.toThrow(GraphQLRequestError);
    await expect(runQuery("query Foo { foo }")).rejects.toThrow("VITE_SOME_ENDPOINT is not configured.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts the query/variables and appends ?opname= from a named operation", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { foo: "bar" } }),
    });

    const runQuery = createGraphQLClient("https://api.test/graphql", "VITE_SOME_ENDPOINT");
    const result = await runQuery("query GetFoo($id: ID!) { foo(id: $id) }", { id: "1" });

    expect(result).toEqual({ foo: "bar" });
    expect(fetch).toHaveBeenCalledTimes(1);

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.test/graphql?opname=GetFoo");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(init.body)).toEqual({
      query: "query GetFoo($id: ID!) { foo(id: $id) }",
      variables: { id: "1" },
    });
  });

  it("does not append opname for an unnamed/unparseable operation", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    });

    const runQuery = createGraphQLClient("https://api.test/graphql", "VITE_SOME_ENDPOINT");
    await runQuery("{ foo }");

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.test/graphql");
  });

  it("throws and records a RUM error on a non-ok HTTP response", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const runQuery = createGraphQLClient("https://api.test/graphql", "VITE_SOME_ENDPOINT");

    await expect(runQuery("query Foo { foo }")).rejects.toThrow("Request failed with status 500");
    expect(recordRumError).toHaveBeenCalledTimes(1);
  });

  it("throws and records a RUM error on a 200 response with a GraphQL errors array", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ errors: [{ message: "bad input" }, { message: "also bad" }] }),
    });

    const runQuery = createGraphQLClient("https://api.test/graphql", "VITE_SOME_ENDPOINT");

    await expect(runQuery("query Foo { foo }")).rejects.toThrow("bad input; also bad");
    expect(recordRumError).toHaveBeenCalledTimes(1);
  });
});
