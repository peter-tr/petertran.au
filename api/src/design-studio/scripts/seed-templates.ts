// One-time (re-runnable) seed of the `templates` collection. Run locally
// with MONGO_URI pointing at the real Atlas cluster:
//
//   MONGO_URI="mongodb+srv://..." npx tsx src/design-studio/scripts/seed-templates.ts
//
// Clears and re-inserts every template rather than diffing - there are only
// a handful of these and they're read-mostly seed data, not user content.
import { getDb } from "../lib/db/client";
import { STARTER_TEMPLATES } from "../lib/templates";

async function main() {
  const db = await getDb();
  const collection = db.collection("templates");

  const { deletedCount } = await collection.deleteMany({});
  const { insertedCount } = await collection.insertMany(STARTER_TEMPLATES);

  console.log(`[seed-templates] removed ${deletedCount} existing, inserted ${insertedCount} templates`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-templates] failed:", err);
  process.exit(1);
});
