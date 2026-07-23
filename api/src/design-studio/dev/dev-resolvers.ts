import { randomUUID } from "node:crypto";
import { createDesignStudioResolvers, type DesignStore } from "../resolvers/resolvers";
import type {
  DesignElementRecord,
  DesignRecord,
  SaveDesignArgs,
  TemplateRecord,
  TemplateFilter,
} from "../lib/design";
import { STARTER_TEMPLATES } from "../lib/templates";

// No real Anthropic call locally - same convention as pantry's
// mockParseCommand, so the dev server never needs an API key. Produces a
// simple background + heading + accent layout, using the prompt itself as
// the heading text so it's obvious in the UI that this came from the typed
// prompt rather than being a fixed template. When currentElements is given
// (a chat-style refinement), just relabels the existing draft's heading
// with the new instruction rather than regenerating it - enough to exercise
// the refinement code path locally without needing real Anthropic calls.
async function mockGenerateDesignElements(
  prompt: string,
  width: number,
  height: number,
  currentElements: DesignElementRecord[] | undefined
): Promise<DesignElementRecord[]> {
  const heading = prompt.trim().slice(0, 60) || "Untitled design";

  if (currentElements?.length) {
    return currentElements.map((el) =>
      el.type === "TEXT" ? { ...el, text: `${el.text} → ${heading}` } : el
    );
  }

  return [
    {
      id: randomUUID(),
      type: "RECTANGLE",
      x: 0,
      y: 0,
      width,
      height,
      rotation: 0,
      zIndex: 0,
      fill: "#1a2130",
      stroke: "",
      strokeWidth: 0,
    },
    {
      id: randomUUID(),
      type: "ELLIPSE",
      x: width * 0.7,
      y: height * -0.1,
      width: width * 0.35,
      height: width * 0.35,
      rotation: 0,
      zIndex: 1,
      fill: "#63c7be",
      stroke: "",
      strokeWidth: 0,
    },
    {
      id: randomUUID(),
      type: "TEXT",
      x: width * 0.08,
      y: height * 0.4,
      width: width * 0.8,
      height: height * 0.15,
      rotation: 0,
      zIndex: 2,
      fill: "#eae7de",
      stroke: "",
      strokeWidth: 0,
      text: heading,
      fontFamily: "IBM Plex Sans",
      fontSize: 40,
      fontWeight: 700,
    },
  ];
}

function matchesFilter(template: TemplateRecord, filter: TemplateFilter): boolean {
  if (filter.category && template.category !== filter.category) return false;
  if (filter.color && !template.colors.includes(filter.color)) return false;
  if (filter.tags?.length && !filter.tags.some((tag) => template.tags.includes(tag))) return false;
  if (filter.search) {
    const haystack = `${template.name} ${template.tags.join(" ")}`.toLowerCase();
    if (!haystack.includes(filter.search.toLowerCase())) return false;
  }

  return true;
}

class InMemoryDesignStore implements DesignStore {
  private designs = new Map<string, DesignRecord>();
  private templates: TemplateRecord[] = STARTER_TEMPLATES.map((template) => ({
    ...template,
    id: randomUUID(),
  }));

  async listDesigns(): Promise<DesignRecord[]> {
    return [...this.designs.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getDesign(id: string): Promise<DesignRecord | null> {
    return this.designs.get(id) ?? null;
  }

  async saveDesign(args: SaveDesignArgs): Promise<DesignRecord> {
    const now = new Date().toISOString();
    const existing = args.id ? this.designs.get(args.id) : undefined;
    const design: DesignRecord = {
      id: existing?.id ?? args.id ?? randomUUID(),
      name: args.name,
      width: args.width,
      height: args.height,
      elements: args.elements,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.designs.set(design.id, design);

    return design;
  }

  async deleteDesign(id: string): Promise<boolean> {
    return this.designs.delete(id);
  }

  async listTemplates(filter: TemplateFilter): Promise<TemplateRecord[]> {
    return this.templates
      .filter((template) => matchesFilter(template, filter))
      .sort((a, b) => b.popularity - a.popularity);
  }

  async saveTemplate(args: Omit<TemplateRecord, "id">): Promise<TemplateRecord> {
    const template: TemplateRecord = { ...args, id: randomUUID() };
    this.templates.push(template);

    return template;
  }
}

export const devResolvers = createDesignStudioResolvers(
  new InMemoryDesignStore(),
  (prompt, width, height, currentElements) =>
    mockGenerateDesignElements(prompt, width, height, currentElements)
);
