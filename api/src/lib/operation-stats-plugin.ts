import type { ApolloServerPlugin } from "@apollo/server";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLE_NAME } from "./ddb";

const RETENTION_DAYS = 30;

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Bucketed by day (not one running total) so getSystemStats can break usage
// down into "recent" vs "all time" windows, and so a TTL can naturally cap
// storage growth -- AI-generated queries get a fresh Claude-chosen name each
// time, so the set of distinct operation names is unbounded otherwise.
async function recordOperation(name: string, durationMs: number): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + RETENTION_DAYS * 24 * 60 * 60;
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: "STATS", sk: `OP#${name}#${dayKey(new Date())}` },
      UpdateExpression: "ADD #count :incr, #totalMs :duration SET #ttl = :ttl",
      ExpressionAttributeNames: { "#count": "count", "#totalMs": "totalMs", "#ttl": "ttl" },
      ExpressionAttributeValues: { ":incr": 1, ":duration": durationMs, ":ttl": ttl },
    })
  );
}

// Records a count + cumulative duration per named operation, feeding the
// "operations" breakdown in systemStats. Runs on every request in production
// only -- dev-server.ts builds its own ApolloServer without this plugin, so
// local dev never touches DynamoDB for it.
export const operationStatsPlugin: ApolloServerPlugin = {
  async requestDidStart() {
    const start = Date.now();
    return {
      async willSendResponse(requestContext) {
        const name = requestContext.operationName ?? "Anonymous";
        try {
          await recordOperation(name, Date.now() - start);
        } catch {
          // Best-effort usage counter -- never let stats tracking break a real response.
        }
      },
    };
  },
};
