import { ObjectId, type Collection, type Filter } from "mongodb";
import { getDb } from "./client";
import type {
  AiSettingsInput,
  AiSettingsRecord,
  DesignElementRecord,
  DesignRecord,
  SaveDesignArgs,
  TemplateRecord,
  TemplateFilter,
} from "../design";
import type { DesignStore } from "../../resolvers/resolvers";

const DEFAULT_AI_SETTINGS: AiSettingsRecord = {
  provider: "BEDROCK",
  modelTier: "SONNET",
  allowSupergraphQuery: false,
};

interface DesignDocument {
  _id: ObjectId;
  name: string;
  width: number;
  height: number;
  createdAt: Date;
  updatedAt: Date;
  elements: DesignElementRecord[];
}

function toRecord(doc: DesignDocument): DesignRecord {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    width: doc.width,
    height: doc.height,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    elements: doc.elements ?? [],
  };
}

interface TemplateDocument {
  _id: ObjectId;
  name: string;
  category: string;
  tags: string[];
  colors: string[];
  popularity: number;
  width: number;
  height: number;
  elements: DesignElementRecord[];
}

function toTemplateRecord(doc: TemplateDocument): TemplateRecord {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    category: doc.category,
    tags: doc.tags ?? [],
    colors: doc.colors ?? [],
    popularity: doc.popularity,
    width: doc.width,
    height: doc.height,
    elements: doc.elements ?? [],
  };
}

let indexesEnsured: Promise<unknown> | null = null;

async function getCollection(): Promise<Collection<DesignDocument>> {
  const db = await getDb();
  const collection = db.collection<DesignDocument>("designs");

  // Lets the gallery's "most recent first" listing be a sorted index scan
  // rather than an in-memory sort. createIndex is idempotent, but this
  // still only runs once per warm Lambda instance rather than per request.
  indexesEnsured ??= collection.createIndex({ updatedAt: -1 });
  await indexesEnsured;

  return collection;
}

let templateIndexesEnsured: Promise<unknown> | null = null;

async function getTemplatesCollection(): Promise<Collection<TemplateDocument>> {
  const db = await getDb();
  const collection = db.collection<TemplateDocument>("templates");

  // The point of this collection existing at all: three different query
  // shapes (free-text search, exact category match, popularity sort) each
  // get their own index, added independently as the search UI grew -
  // no pre-planned access pattern the way a DynamoDB GSI would need.
  templateIndexesEnsured ??= Promise.all([
    collection.createIndex({ name: "text", tags: "text" }),
    collection.createIndex({ category: 1 }),
    collection.createIndex({ popularity: -1 }),
  ]);
  await templateIndexesEnsured;

  return collection;
}

// Single-document collection - one shared setting for the whole editor, so
// this is always looked up by the fixed "ai" id rather than a query filter.
interface AiSettingsDocument extends AiSettingsRecord {
  _id: "ai";
}

async function getSettingsCollection(): Promise<Collection<AiSettingsDocument>> {
  const db = await getDb();

  return db.collection<AiSettingsDocument>("settings");
}

function buildTemplateQuery(filter: TemplateFilter): Filter<TemplateDocument> {
  const query: Filter<TemplateDocument> = {};

  if (filter.category) query.category = filter.category;
  if (filter.color) query.colors = filter.color;
  if (filter.tags?.length) query.tags = { $in: filter.tags };
  if (filter.search) query.$text = { $search: filter.search };

  return query;
}

export class MongoDesignStore implements DesignStore {
  async listDesigns(): Promise<DesignRecord[]> {
    const collection = await getCollection();
    const docs = await collection.find().sort({ updatedAt: -1 }).toArray();

    return docs.map(toRecord);
  }

  async getDesign(id: string): Promise<DesignRecord | null> {
    if (!ObjectId.isValid(id)) return null;

    const collection = await getCollection();
    const doc = await collection.findOne({ _id: new ObjectId(id) });

    return doc ? toRecord(doc) : null;
  }

  async saveDesign(args: SaveDesignArgs): Promise<DesignRecord> {
    const collection = await getCollection();
    const now = new Date();

    if (args.id) {
      if (!ObjectId.isValid(args.id)) throw new Error("Invalid design id.");

      const _id = new ObjectId(args.id);
      await collection.updateOne(
        { _id },
        {
          $set: {
            name: args.name,
            width: args.width,
            height: args.height,
            elements: args.elements,
            updatedAt: now,
          },
        }
      );

      const doc = await collection.findOne({ _id });
      if (!doc) throw new Error("Design not found after update.");

      return toRecord(doc);
    }

    const doc: DesignDocument = {
      _id: new ObjectId(),
      name: args.name,
      width: args.width,
      height: args.height,
      elements: args.elements,
      createdAt: now,
      updatedAt: now,
    };
    await collection.insertOne(doc);

    return toRecord(doc);
  }

  async deleteDesign(id: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;

    const collection = await getCollection();
    const result = await collection.deleteOne({ _id: new ObjectId(id) });

    return result.deletedCount === 1;
  }

  async listTemplates(filter: TemplateFilter): Promise<TemplateRecord[]> {
    const collection = await getTemplatesCollection();
    const docs = await collection.find(buildTemplateQuery(filter)).sort({ popularity: -1 }).toArray();

    return docs.map(toTemplateRecord);
  }

  async saveTemplate(args: Omit<TemplateRecord, "id">): Promise<TemplateRecord> {
    const collection = await getTemplatesCollection();
    const doc: TemplateDocument = { _id: new ObjectId(), ...args };
    await collection.insertOne(doc);

    return toTemplateRecord(doc);
  }

  async getAiSettings(): Promise<AiSettingsRecord> {
    const collection = await getSettingsCollection();
    const doc = await collection.findOne({ _id: "ai" });

    // Spread order backfills defaults for fields missing on a document
    // written before they existed - same discipline as
    // withDesignDefaults()/pantry's getSettings() merge.
    return { ...DEFAULT_AI_SETTINGS, ...doc };
  }

  async updateAiSettings(input: AiSettingsInput): Promise<AiSettingsRecord> {
    const collection = await getSettingsCollection();
    const current = await this.getAiSettings();
    const updated: AiSettingsRecord = { ...current, ...input };

    await collection.updateOne({ _id: "ai" }, { $set: updated }, { upsert: true });

    return updated;
  }
}
