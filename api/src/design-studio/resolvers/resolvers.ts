import {
  withDesignDefaults,
  deriveColors,
  type AiSettingsInput,
  type AiSettingsRecord,
  type DesignElementRecord,
  type DesignRecord,
  type SaveDesignArgs,
  type SaveAsTemplateArgs,
  type TemplateRecord,
  type TemplateFilter,
} from "../lib/design";
import { generateDesignElements as defaultGenerateDesignElements } from "../lib/anthropic/generate-elements";
import type { Context } from "../context";

export interface DesignStore {
  listDesigns(): Promise<DesignRecord[]>;
  getDesign(id: string): Promise<DesignRecord | null>;
  saveDesign(args: SaveDesignArgs): Promise<DesignRecord>;
  deleteDesign(id: string): Promise<boolean>;
  listTemplates(filter: TemplateFilter): Promise<TemplateRecord[]>;
  saveTemplate(args: Omit<TemplateRecord, "id">): Promise<TemplateRecord>;
  deleteTemplate(id: string): Promise<boolean>;
  getAiSettings(): Promise<AiSettingsRecord>;
  updateAiSettings(input: AiSettingsInput): Promise<AiSettingsRecord>;
}

// Kept separate from DesignStore - generation isn't a persistence concern,
// so it's injected as its own dependency rather than bolted onto the store
// interface. The real (Mongo) backend just uses the default (a real
// Anthropic/Bedrock call); the dev backend passes a mock so the local dev
// server never needs real credentials for either provider.
export type GenerateDesignElementsFn = (
  prompt: string,
  width: number,
  height: number,
  currentElements: DesignElementRecord[] | undefined,
  sourceIp: string | undefined,
  aiSettings: AiSettingsRecord
) => Promise<DesignElementRecord[]>;

// Shared resolver logic for both the real (Mongo) and dev (in-memory)
// backends - only the storage implementation (and the AI generation
// implementation) differs between them.
export function createDesignStudioResolvers(
  store: DesignStore,
  generateDesignElements: GenerateDesignElementsFn = defaultGenerateDesignElements
) {
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
      aiSettings: () => store.getAiSettings(),
    },
    Mutation: {
      saveDesign: async (_: unknown, args: { input: SaveDesignArgs }) => {
        const saved = await store.saveDesign(args.input);

        return withDesignDefaults(saved);
      },
      deleteDesign: async (_: unknown, args: { id: string }) => store.deleteDesign(args.id),
      saveAsTemplate: (_: unknown, args: { input: SaveAsTemplateArgs }) =>
        store.saveTemplate({
          ...args.input,
          colors: deriveColors(args.input.elements),
          popularity: 0,
          isCustom: true,
        }),
      deleteTemplate: async (_: unknown, args: { id: string }) => store.deleteTemplate(args.id),
      generateDesignElements: async (
        _: unknown,
        args: {
          prompt: string;
          width: number;
          height: number;
          currentElements?: DesignElementRecord[] | null;
        },
        context: Context
      ) => {
        const aiSettings = await store.getAiSettings();

        return generateDesignElements(
          args.prompt,
          args.width,
          args.height,
          args.currentElements ?? undefined,
          context.sourceIp,
          aiSettings
        );
      },
      updateAiSettings: (_: unknown, args: { input: AiSettingsInput }) => store.updateAiSettings(args.input),
    },
  };
}
