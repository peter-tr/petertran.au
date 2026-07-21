import { withDesignDefaults, type DesignRecord, type SaveDesignArgs } from "../lib/design";

export interface DesignStore {
  listDesigns(): Promise<DesignRecord[]>;
  getDesign(id: string): Promise<DesignRecord | null>;
  saveDesign(args: SaveDesignArgs): Promise<DesignRecord>;
  deleteDesign(id: string): Promise<boolean>;
}

// Shared resolver logic for both the real (Mongo) and dev (in-memory)
// backends - only the storage implementation differs between them.
export function createDesignStudioResolvers(store: DesignStore) {
  return {
    Query: {
      designs: async () => {
        const designs = await store.listDesigns();
        return designs.map(withDesignDefaults);
      },
      design: async (_: unknown, args: { id: string }) => {
        const design = await store.getDesign(args.id);
        return design ? withDesignDefaults(design) : null;
      },
    },
    Mutation: {
      saveDesign: async (_: unknown, args: { input: SaveDesignArgs }) => {
        const saved = await store.saveDesign(args.input);
        return withDesignDefaults(saved);
      },
      deleteDesign: async (_: unknown, args: { id: string }) => store.deleteDesign(args.id),
    },
  };
}
