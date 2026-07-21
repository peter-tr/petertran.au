import { describe, expect, it, vi } from "vitest";
import { createDesignStudioResolvers, type DesignStore } from "./resolvers";
import type { DesignRecord } from "../lib/design";

function makeDesign(overrides: Partial<DesignRecord> = {}): DesignRecord {
  return {
    id: "1",
    name: "Untitled",
    width: 900,
    height: 600,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    elements: [],
    ...overrides,
  };
}

function makeStore(overrides: Partial<DesignStore> = {}): DesignStore {
  return {
    listDesigns: vi.fn().mockResolvedValue([]),
    getDesign: vi.fn().mockResolvedValue(null),
    saveDesign: vi.fn(),
    deleteDesign: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("createDesignStudioResolvers", () => {
  it("Query.designs backfills elements when the stored record is missing it", async () => {
    // Casting through unknown since a pre-existing document is exactly the
    // case a stored record wouldn't satisfy DesignRecord's own type.
    const legacyDesign = { ...makeDesign(), elements: undefined } as unknown as DesignRecord;
    const store = makeStore({ listDesigns: vi.fn().mockResolvedValue([legacyDesign]) });

    const resolvers = createDesignStudioResolvers(store);
    const result = await resolvers.Query.designs();

    expect(result[0].elements).toEqual([]);
  });

  it("Query.design returns null when the store has nothing for that id", async () => {
    const store = makeStore();
    const resolvers = createDesignStudioResolvers(store);

    expect(await resolvers.Query.design({}, { id: "missing" })).toBeNull();
  });

  it("Mutation.saveDesign passes the input straight through to the store", async () => {
    const saved = makeDesign({ id: "42", name: "My design" });
    const store = makeStore({ saveDesign: vi.fn().mockResolvedValue(saved) });
    const resolvers = createDesignStudioResolvers(store);

    const input = { name: "My design", width: 900, height: 600, elements: [] };
    const result = await resolvers.Mutation.saveDesign({}, { input });

    expect(store.saveDesign).toHaveBeenCalledWith(input);
    expect(result.id).toBe("42");
  });

  it("Mutation.deleteDesign returns the store's result", async () => {
    const store = makeStore({ deleteDesign: vi.fn().mockResolvedValue(false) });
    const resolvers = createDesignStudioResolvers(store);

    expect(await resolvers.Mutation.deleteDesign({}, { id: "1" })).toBe(false);
  });
});
