export type DesignElementType = "RECTANGLE" | "ELLIPSE" | "TEXT" | "ARROW";

export interface DesignElementRecord {
  id: string;
  type: DesignElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
}

export interface DesignRecord {
  id: string;
  name: string;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
  elements: DesignElementRecord[];
}

export interface SaveDesignArgs {
  id?: string | null;
  name: string;
  width: number;
  height: number;
  elements: DesignElementRecord[];
}

// Backfills fields that might be missing on a document written before this
// field existed - same discipline as pantry's getSettings() merge, applies
// here even though the store is Mongo rather than DynamoDB.
export function withDesignDefaults(design: DesignRecord): DesignRecord {
  return { ...design, elements: design.elements ?? [] };
}

export interface TemplateRecord {
  id: string;
  name: string;
  category: string;
  tags: string[];
  colors: string[];
  popularity: number;
  width: number;
  height: number;
  elements: DesignElementRecord[];
}

// A template's seed data, before it has a store-assigned id - what
// scripts/seed-templates.ts inserts and the in-memory dev store seeds
// itself with, so both share one definition instead of two.
export type TemplateSeed = Omit<TemplateRecord, "id">;

export interface TemplateFilter {
  search?: string | null;
  category?: string | null;
  tags?: string[] | null;
  color?: string | null;
}

export interface SaveAsTemplateArgs {
  name: string;
  category: string;
  tags: string[];
  width: number;
  height: number;
  elements: DesignElementRecord[];
}

export type { AiProvider, AiModelTier } from "api-shared/ai-provider";
import type { AiProvider, AiModelTier } from "api-shared/ai-provider";

// Operator-configurable, not per-user - there's one editor, so one shared
// setting. Deliberately decoupled from the raw model ID string: BEDROCK's
// inference-profile IDs (e.g. "us.anthropic.claude-sonnet-4-6") don't match
// ANTHROPIC's bare ones (e.g. "claude-sonnet-4-6"), so storing a tier lets
// generate-elements.ts resolve the actual per-provider ID rather than the
// caller needing to know both formats. AiProvider/AiModelTier themselves
// live in api-shared/ai-provider, shared with pantry's equivalent setting.
export interface AiSettingsRecord {
  provider: AiProvider;
  modelTier: AiModelTier;
}

export interface AiSettingsInput {
  provider?: AiProvider;
  modelTier?: AiModelTier;
}

const MAX_DERIVED_COLORS = 4;

// Templates carry `colors` for the swatch filter, but nobody hand-picks
// them - they're just the design's own distinct fill values, same as what
// a viewer would actually see looking at the canvas.
export function deriveColors(elements: DesignElementRecord[]): string[] {
  const distinct = [...new Set(elements.map((el) => el.fill))];

  return distinct.slice(0, MAX_DERIVED_COLORS);
}
