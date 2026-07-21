import { ObjectId, type Collection } from "mongodb";
import { getDb } from "./client";
import type { DesignElementRecord, DesignRecord, SaveDesignArgs } from "../design";
import type { DesignStore } from "../../resolvers/resolvers";

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
}
