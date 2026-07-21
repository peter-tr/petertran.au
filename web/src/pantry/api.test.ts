import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADD_TO_SHOPPING_LIST_MUTATION,
  PANTRY_ACTION_MUTATIONS,
  PANTRY_ENDPOINT,
  RECORD_PURCHASE_MUTATION,
  REMOVE_FROM_SHOPPING_LIST_MUTATION,
  REMOVE_INVENTORY_ITEM_MUTATION,
  UPDATE_INVENTORY_ITEM_MUTATION,
  runPantryQuery,
} from "./api";

// PANTRY_ACTION_MUTATIONS is what PantryCommandBar looks up by the AI's
// `mutationName` string (see confirmActions in PantryCommandBar.tsx) - a
// missing or mismatched entry here means a proposed action silently becomes
// "Unknown action ... - skipped" instead of running.
describe("PANTRY_ACTION_MUTATIONS", () => {
  it("maps every known mutationName to its matching mutation document", () => {
    expect(PANTRY_ACTION_MUTATIONS).toEqual({
      recordPurchase: RECORD_PURCHASE_MUTATION,
      updateInventoryItem: UPDATE_INVENTORY_ITEM_MUTATION,
      removeInventoryItem: REMOVE_INVENTORY_ITEM_MUTATION,
      addToShoppingList: ADD_TO_SHOPPING_LIST_MUTATION,
      removeFromShoppingList: REMOVE_FROM_SHOPPING_LIST_MUTATION,
    });
  });

  it("has no entry for an unrecognized mutation name", () => {
    expect(PANTRY_ACTION_MUTATIONS["deleteEverything"]).toBeUndefined();
  });
});

// Every exported query/mutation document must be a syntactically named
// operation (createGraphQLClient's withOperationName relies on this to tag
// requests for RUM), and every self-embedded fragment reference must
// actually have its definition present in the same string (GraphQL rejects
// an undefined fragment spread).
describe("GraphQL documents", () => {
  const documents: Record<string, string> = {
    RECORD_PURCHASE_MUTATION,
    UPDATE_INVENTORY_ITEM_MUTATION,
    REMOVE_INVENTORY_ITEM_MUTATION,
    ADD_TO_SHOPPING_LIST_MUTATION,
    REMOVE_FROM_SHOPPING_LIST_MUTATION,
  };

  it("each document declares a name that createGraphQLClient's operation-name regex can find", () => {
    const namePattern = /^\s*(?:query|mutation|subscription)\s+([A-Za-z_]\w*)/;
    for (const [key, doc] of Object.entries(documents)) {
      expect(namePattern.test(doc), `${key} should declare an operation name`).toBe(true);
    }
  });

  it("every fragment spread in a document has a matching fragment definition inline", () => {
    for (const [key, doc] of Object.entries(documents)) {
      const spreads = [...doc.matchAll(/\.\.\.(\w+)/g)].map((m) => m[1]);
      for (const name of spreads) {
        expect(doc, `${key} spreads ...${name} but never defines it`).toContain(`fragment ${name} on`);
      }
    }
  });
});

describe("PANTRY_ENDPOINT / runPantryQuery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is configured from the test environment", () => {
    expect(PANTRY_ENDPOINT).toBe("https://api.test.petertran.au/graphql");
  });

  it("posts the query/variables as JSON to the configured endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { ok: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runPantryQuery("query Foo { foo }", { a: 1 });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("api.test.petertran.au/graphql");
    expect(String(url)).toContain("opname=Foo");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ query: "query Foo { foo }", variables: { a: 1 } });
  });

  it("throws when the response contains GraphQL errors, even with HTTP 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ errors: [{ message: "bad input" }] }),
      })
    );

    await expect(runPantryQuery("query Foo { foo }")).rejects.toThrow("bad input");
  });

  it("throws when the HTTP response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      })
    );

    await expect(runPantryQuery("query Foo { foo }")).rejects.toThrow("500");
  });
});
