import { randomUUID } from "node:crypto";
import {
  withDesignDefaults,
  type DesignRecord,
  type SaveDesignArgs,
  type TemplateRecord,
  type TemplateFilter,
} from "../lib/design";

export interface DesignStore {
  listDesigns(): Promise<DesignRecord[]>;
  getDesign(id: string): Promise<DesignRecord | null>;
  saveDesign(args: SaveDesignArgs): Promise<DesignRecord>;
  deleteDesign(id: string): Promise<boolean>;
  listTemplates(filter: TemplateFilter): Promise<TemplateRecord[]>;
  getTemplate(id: string): Promise<TemplateRecord | null>;
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
      templates: (_: unknown, args: TemplateFilter) => store.listTemplates(args),
    },
    Mutation: {
      saveDesign: async (_: unknown, args: { input: SaveDesignArgs }) => {
        const saved = await store.saveDesign(args.input);
        return withDesignDefaults(saved);
      },
      deleteDesign: async (_: unknown, args: { id: string }) => store.deleteDesign(args.id),
      useTemplate: async (_: unknown, args: { templateId: string }) => {
        const template = await store.getTemplate(args.templateId);
        if (!template) throw new Error("That template wasn't found.");

        // Fresh ids for every element - reusing the template's own ids
        // would collide the moment someone creates a second design from
        // the same template.
        const saved = await store.saveDesign({
          name: template.name,
          width: template.width,
          height: template.height,
          elements: template.elements.map((element) => ({ ...element, id: randomUUID() })),
        });

        return withDesignDefaults(saved);
      },
    },
  };
}
