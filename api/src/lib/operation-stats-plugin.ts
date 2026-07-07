import type { ApolloServerPlugin } from "@apollo/server";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import * as AWSXRay from "aws-xray-sdk-core";
import { ddb, TABLE_NAME } from "./ddb";
import type { Context } from "../context";

const RETENTION_DAYS = 30;

// IntrospectionQuery is standard tooling bookkeeping, not real usage --
// GraphiQL fires it automatically on every page load to build its
// autocomplete/docs, regardless of anything the visitor actually does.
// TraceBreakdown is the dashboard looking at its own trace data -- tracking
// it would mean every expanded row adds another row to expand.
const IGNORED_OPERATIONS = new Set(["IntrospectionQuery", "TraceBreakdown"]);

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface QuerySample {
  query: string;
  variables: Record<string, unknown> | undefined;
}

// Bucketed by day (not one running total) so getSystemStats can break usage
// down into "recent" vs "all time" windows, and so a TTL can naturally cap
// storage growth -- AI-generated queries get a fresh Claude-chosen name each
// time, so the set of distinct operation names is unbounded otherwise.
async function recordOperation(
  name: string,
  durationMs: number,
  sample: QuerySample | null,
  traceId: string | null
): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + RETENTION_DAYS * 24 * 60 * 60;

  const setClauses = ["#ttl = :ttl"];
  const names: Record<string, string> = { "#count": "count", "#totalMs": "totalMs", "#ttl": "ttl" };
  const values: Record<string, unknown> = { ":incr": 1, ":duration": durationMs, ":ttl": ttl };

  // Mutations are never sampled -- the sendMessage/ReachOut mutation carries a
  // visitor's real name/email/message, and this data feeds a public GraphQL
  // field, so recording its variables would leak contact-form submissions.
  if (sample) {
    setClauses.push("#lastQuery = :lastQuery", "#lastVariables = :lastVariables");
    names["#lastQuery"] = "lastQuery";
    names["#lastVariables"] = "lastVariables";
    values[":lastQuery"] = sample.query;
    values[":lastVariables"] =
      sample.variables && Object.keys(sample.variables).length > 0 ? JSON.stringify(sample.variables) : null;
  }

  if (traceId) {
    setClauses.push("#lastTraceId = :lastTraceId");
    names["#lastTraceId"] = "lastTraceId";
    values[":lastTraceId"] = traceId;
  }

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: "STATS", sk: `OP#${name}#${dayKey(new Date())}` },
      UpdateExpression: `ADD #count :incr, #totalMs :duration SET ${setClauses.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
}

// One item per day holding a DynamoDB String Set of source IPs -- ADD on a
// set is naturally idempotent, so this gives a real unique-visitor count
// without needing cookies or any client-side identifier.
async function recordVisitor(sourceIp: string): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + RETENTION_DAYS * 24 * 60 * 60;
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: "STATS", sk: `VISITORS#${dayKey(new Date())}` },
      UpdateExpression: "ADD #ips :ip SET #ttl = :ttl",
      ExpressionAttributeNames: { "#ips": "ips", "#ttl": "ttl" },
      ExpressionAttributeValues: { ":ip": new Set([sourceIp]), ":ttl": ttl },
    })
  );
}

// Records a count + cumulative duration per named operation, feeding the
// "operations" breakdown in systemStats. Runs on every request in production
// only -- dev-server.ts builds its own ApolloServer without this plugin, so
// local dev never touches DynamoDB for it.
export const operationStatsPlugin: ApolloServerPlugin<Context> = {
  async requestDidStart() {
    const start = Date.now();
    return {
      async willSendResponse(requestContext) {
        const sourceIp = requestContext.contextValue.sourceIp;
        if (sourceIp) {
          try {
            await recordVisitor(sourceIp);
          } catch {
            // Best-effort -- never let stats tracking break a real response.
          }
        }

        const name = requestContext.operationName ?? "Anonymous";
        if (IGNORED_OPERATIONS.has(name)) return;

        const isMutation = requestContext.operation?.operation === "mutation";
        const sample = isMutation
          ? null
          : { query: requestContext.request.query ?? "", variables: requestContext.request.variables };
        // getSegment() logs a noisy "context missing" error if called outside
        // an active X-Ray context (e.g. local dev has no daemon/segment at
        // all), so only call it in Lambda. It can return either the root
        // Segment or a Subsegment depending on call context -- only the root
        // carries trace_id, so a Subsegment needs one hop up via `.segment`.
        const current = process.env.AWS_LAMBDA_FUNCTION_NAME ? AWSXRay.getSegment() : undefined;
        const traceId = current ? ("segment" in current ? current.segment.trace_id : current.trace_id) : null;

        try {
          await recordOperation(name, Date.now() - start, sample, traceId);
        } catch {
          // Best-effort usage counter -- never let stats tracking break a real response.
        }
      },
    };
  },
};
