import type { ApolloServerPlugin, BaseContext } from "@apollo/server";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";

const METRICS_NAMESPACE = "PetertranAu/GraphQL";

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// CloudWatch auto-parses any stdout line shaped like this (Embedded Metric
// Format) into a real metric -- no PutMetricData call, no extra AWS SDK
// client, no added request latency. Two dimension sets on the same datum so
// it's queryable either as a per-project total or broken down by operation,
// without emitting the point twice.
export function emitOperationCountMetric(
  project: string,
  operationName: string,
  operationType: string
): void {
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: METRICS_NAMESPACE,
            Dimensions: [["project"], ["project", "operationName"]],
            Metrics: [{ Name: "OperationCount", Unit: "Count" }],
          },
        ],
      },
      project,
      operationName,
      operationType,
      OperationCount: 1,
    })
  );
}

// IntrospectionQuery is standard GraphiQL/tooling bookkeeping fired on every
// page load, not real usage.
const DEFAULT_IGNORED_OPERATIONS = new Set(["IntrospectionQuery"]);

async function recordOperationCount(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  pk: string,
  sk: string
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk, sk },
      UpdateExpression: "ADD #count :incr",
      ExpressionAttributeNames: { "#count": "count" },
      ExpressionAttributeValues: { ":incr": 1 },
    })
  );
}

export interface OperationMetricsConfig {
  project: string;
  ddb: DynamoDBDocumentClient;
  tableName: string;
  // The pk value operation-count rows are written under. Pass each project's
  // own convention (e.g. pantry's single-partition PK, or a dedicated "STATS"
  // partition) rather than hardcoding one here.
  pk: string;
  skPrefix?: string;
  ignoredOperations?: Set<string>;
}

// Lightweight per-operation counter for projects that don't need portfolio's
// richer duration/query-sample/visitor tracking (see portfolio's own
// lib/util/operation-stats-plugin.ts) -- just "how many times was each
// operation called", recorded day-bucketed in DynamoDB and as a CloudWatch
// metric. Runs on every request; both writes are best-effort so metrics
// tracking never breaks a real response.
export function createOperationMetricsPlugin<TContext extends BaseContext = BaseContext>(
  config: OperationMetricsConfig
): ApolloServerPlugin<TContext> {
  const skPrefix = config.skPrefix ?? "OP#";
  const ignoredOperations = config.ignoredOperations ?? DEFAULT_IGNORED_OPERATIONS;

  return {
    async requestDidStart() {
      return {
        async willSendResponse(requestContext) {
          const operationName = requestContext.operationName ?? "Anonymous";
          if (ignoredOperations.has(operationName)) return;

          const operationType = requestContext.operation?.operation ?? "unknown";

          emitOperationCountMetric(config.project, operationName, operationType);

          try {
            await recordOperationCount(
              config.ddb,
              config.tableName,
              config.pk,
              `${skPrefix}${operationName}#${dayKey(new Date())}`
            );
          } catch {
            // Best-effort usage counter -- never let stats tracking break a real response.
          }
        },
      };
    },
  };
}
