import type { ApolloServerPlugin } from "@apollo/server";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { trace } from "@opentelemetry/api";
import { emitOperationCountMetric } from "api-shared/operation-metrics";
import { ddb, TABLE_NAME } from "../aws/ddb";
import type { Context } from "../../context";

// IntrospectionQuery is standard tooling bookkeeping, not real usage --
// GraphiQL fires it automatically on every page load to build its
// autocomplete/docs, regardless of anything the visitor actually does.
// TraceBreakdown and SystemStats are the dashboard looking at its own data --
// tracking either would mean every dashboard load (and its poll interval)
// inflates its own visitor/request counts.
const IGNORED_OPERATIONS = new Set(["IntrospectionQuery", "TraceBreakdown", "SystemStats"]);

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
      // These writes are independent (different keys), so they're fired
      // together rather than awaited one at a time -- willSendResponse blocks
      // the actual response, so sequential awaits here were pure added
      // latency on every request.
      async willSendResponse(requestContext) {
        const tasks: Promise<unknown>[] = [];

        const sourceIp = requestContext.contextValue.sourceIp;
        if (sourceIp) {
          // Best-effort -- never let stats tracking break a real response.
          tasks.push(recordVisitorAllTime(sourceIp).catch(() => {}));
        }
        tasks.push(recordTotalRequests().catch(() => {}));

        const name = requestContext.operationName ?? "Anonymous";
        if (!IGNORED_OPERATIONS.has(name)) {
          emitOperationCountMetric("portfolio", name, requestContext.operation?.operation ?? "unknown");

          const isMutation = requestContext.operation?.operation === "mutation";
          const sample = isMutation
            ? null
            : { query: requestContext.request.query ?? "", variables: requestContext.request.variables };
          // The ADOT layer's own instrumentation-aws-lambda span is active for
          // the whole invocation, so this is available outside Lambda-only
          // guards too - but OTel's raw trace id is a bare 32-hex-char string
          // with no dashes, while getTraceBreakdown()'s BatchGetTraces call
          // (and the classic X-Ray console) expect the classic
          // "1-<8 hex>-<24 hex>" format - confirmed by hand-converting ids
          // this same way against real deployed traces. Only meaningful in
          // Lambda (no active span in local dev), same guard as before.
          const rawTraceId = process.env.AWS_LAMBDA_FUNCTION_NAME
            ? trace.getActiveSpan()?.spanContext().traceId
            : undefined;
          const traceId = rawTraceId ? `1-${rawTraceId.slice(0, 8)}-${rawTraceId.slice(8)}` : null;

          tasks.push(recordOperation(name, Date.now() - start, sample, traceId).catch(() => {}));
        }

        await Promise.all(tasks);
      },
    };
  },
};
