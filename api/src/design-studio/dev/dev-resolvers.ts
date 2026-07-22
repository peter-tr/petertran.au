import { randomUUID } from "node:crypto";
import { createDesignStudioResolvers, type DesignStore } from "../resolvers/resolvers";
import type { DesignRecord, SaveDesignArgs, TemplateRecord, TemplateFilter } from "../lib/design";
import { STARTER_TEMPLATES } from "../lib/templates";

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

  async getTemplate(id: string): Promise<TemplateRecord | null> {
    return this.templates.find((template) => template.id === id) ?? null;
  }
}

export const devResolvers = createDesignStudioResolvers(new InMemoryDesignStore());
