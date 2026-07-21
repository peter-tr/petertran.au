import { describe, expect, it, vi } from "vitest";
import { createDesignStudioResolvers, type DesignStore } from "./resolvers";
import type { DesignRecord, TemplateRecord } from "../lib/design";

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

function makeTemplate(overrides: Partial<TemplateRecord> = {}): TemplateRecord {
  return {
    id: "tpl-1",
    name: "Bold Announcement",
    category: "Poster",
    tags: ["poster", "bold"],
    colors: ["#f2a93b"],
    popularity: 92,
    width: 900,
    height: 600,
    elements: [
      {
        id: "el-1",
        type: "RECTANGLE",
        x: 0,
        y: 0,
        width: 900,
        height: 600,
        rotation: 0,
        zIndex: 0,
        fill: "#0b0e14",
        stroke: "",
        strokeWidth: 0,
      },
    ],
    ...overrides,
  };
}

function makeStore(overrides: Partial<DesignStore> = {}): DesignStore {
  return {
    listDesigns: vi.fn().mockResolvedValue([]),
    getDesign: vi.fn().mockResolvedValue(null),
    saveDesign: vi.fn(),
    deleteDesign: vi.fn().mockResolvedValue(true),
    listTemplates: vi.fn().mockResolvedValue([]),
    getTemplate: vi.fn().mockResolvedValue(null),
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

  it("Query.templates passes the filter args straight through to the store", async () => {
    const templates = [makeTemplate()];
    const store = makeStore({ listTemplates: vi.fn().mockResolvedValue(templates) });
    const resolvers = createDesignStudioResolvers(store);

    const args = { category: "Poster", search: null, tags: null, color: null };
    const result = await resolvers.Query.templates({}, args);

    expect(store.listTemplates).toHaveBeenCalledWith(args);
    expect(result).toEqual(templates);
  });

  it("Mutation.useTemplate clones the template's elements with fresh ids into a new design", async () => {
    const template = makeTemplate();
    const saved = makeDesign({ id: "new-design", name: template.name });
    const store = makeStore({
      getTemplate: vi.fn().mockResolvedValue(template),
      saveDesign: vi.fn().mockResolvedValue(saved),
    });
    const resolvers = createDesignStudioResolvers(store);

    const result = await resolvers.Mutation.useTemplate({}, { templateId: "tpl-1" });

    expect(store.getTemplate).toHaveBeenCalledWith("tpl-1");
    const [saveArgs] = vi.mocked(store.saveDesign).mock.calls[0];
    expect(saveArgs.name).toBe(template.name);
    expect(saveArgs.elements).toHaveLength(1);
    expect(saveArgs.elements[0].id).not.toBe(template.elements[0].id);
    expect(result.id).toBe("new-design");
  });

  it("Mutation.useTemplate throws when the template doesn't exist", async () => {
    const store = makeStore({ getTemplate: vi.fn().mockResolvedValue(null) });
    const resolvers = createDesignStudioResolvers(store);

    await expect(resolvers.Mutation.useTemplate({}, { templateId: "missing" })).rejects.toThrow(
      "wasn't found"
    );
  });
});
