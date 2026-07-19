import type { ApolloServerPlugin } from "@apollo/server";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import * as AWSXRay from "aws-xray-sdk-core";
import { ddb, TABLE_NAME } from "../aws/ddb";
import type { Context } from "../../context";

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

// Bucketed by day (no TTL - kept forever) so getSystemStats can break usage
// down into "last 30 days" vs true all-time. A low-traffic personal site
// accumulates at most a few hundred of these rows a year even with
// AI-generated queries minting a fresh operation name each time, so
// unbounded retention here is cheap.
async function recordOperation(
  name: string,
  durationMs: number,
  sample: QuerySample | null,
  traceId: string | null
): Promise<void> {
  const setClauses: string[] = [];
  const names: Record<string, string> = { "#count": "count", "#totalMs": "totalMs" };
  const values: Record<string, unknown> = { ":incr": 1, ":duration": durationMs };

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

  const updateExpression =
    `ADD #count :incr, #totalMs :duration` + (setClauses.length > 0 ? ` SET ${setClauses.join(", ")}` : "");

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: "STATS", sk: `OP#${name}#${dayKey(new Date())}` },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
}

// A single running counter, never bucketed or expired -- the site's true
// lifetime request count, immune to the "resets to a small number every
// day/month" problem a windowed metric has on a low-traffic personal site.
async function recordTotalRequests(): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: "STATS", sk: "TOTAL_REQUESTS" },
      UpdateExpression: "ADD #count :incr",
      ExpressionAttributeNames: { "#count": "count" },
      ExpressionAttributeValues: { ":incr": 1 },
    })
  );
}

// One item, one DynamoDB String Set of every source IP ever seen -- ADD on a
// set is naturally idempotent, so this gives a real all-time unique-visitor
// count with no cookies or client-side identifier, and no reset window.
async function recordVisitorAllTime(sourceIp: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: "STATS", sk: "VISITORS_ALL_TIME" },
      UpdateExpression: "ADD #ips :ip",
      ExpressionAttributeNames: { "#ips": "ips" },
      ExpressionAttributeValues: { ":ip": new Set([sourceIp]) },
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
            await recordVisitorAllTime(sourceIp);
          } catch {
            // Best-effort -- never let stats tracking break a real response.
          }
        }

        try {
          await recordTotalRequests();
        } catch {
          // Best-effort -- never let stats tracking break a real response.
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
