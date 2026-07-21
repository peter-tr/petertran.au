import { randomUUID } from "node:crypto";
import { createDesignStudioResolvers, type DesignStore } from "../resolvers/resolvers";
import type { DesignRecord, SaveDesignArgs } from "../lib/design";

class InMemoryDesignStore implements DesignStore {
  private designs = new Map<string, DesignRecord>();

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
}

export const devResolvers = createDesignStudioResolvers(new InMemoryDesignStore());
