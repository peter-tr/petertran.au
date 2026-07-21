export type DesignElementType = "RECTANGLE" | "ELLIPSE" | "TEXT";

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
