import { getDb } from "../db/client";

// One-off-ask style, matching portfolio's/imposter's Anthropic limiters
// rather than pantry's conversational 15/min - a single design-generation
// prompt per request, not a back-and-forth command bar.
const LIMIT_PER_MINUTE = 5;
// Comfortable margin over the 60s bucket width so Mongo's TTL monitor
// (which sweeps roughly once a minute) has room to reap a bucket after
// it's no longer needed - same reasoning as the shared DynamoDB limiter's
// windowSeconds.
const TTL_SECONDS = 120;

interface RateLimitDocument {
  _id: string;
  count: number;
  expiresAt: Date;
}

let indexEnsured: Promise<unknown> | null = null;

async function getCollection() {
  const db = await getDb();
  const collection = db.collection<RateLimitDocument>("ai_rate_limits");
  indexEnsured ??= collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await indexEnsured;

  return collection;
}

// Mongo-backed equivalent of api-shared/rate-limit's fixed-window DynamoDB
// counter - design-studio deliberately has no DynamoDB table (see
// design-studio-stack.ts's doc comment), so that shared helper doesn't
// apply here. Not promoted into api-shared since this is still the only
// Mongo-based consumer of a rate limiter - it gets generalized once a
// second one actually needs it, not before.
export async function assertAiNotRateLimited(sourceIp: string | undefined): Promise<void> {
  if (!sourceIp) return;

  const collection = await getCollection();
  const bucket = Math.floor(Date.now() / 60_000);
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);

  const result = await collection.findOneAndUpdate(
    { _id: `${sourceIp}#${bucket}` },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
    { upsert: true, returnDocument: "after" }
  );

  if (result && result.count > LIMIT_PER_MINUTE) {
    throw new Error("Too many requests - please wait a moment and try again.");
  }
}
