import { ApolloServer } from "@apollo/server";
import { startServerAndCreateLambdaHandler, handlers } from "@as-integrations/aws-lambda";
import * as AWSXRay from "aws-xray-sdk-core";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context as LambdaContext,
} from "aws-lambda";
import { typeDefs } from "./schema";
import { resolvers } from "./resolvers/resolvers";
import { isWarmupPing, type WarmupPing } from "api-shared/warmup";
import { createOperationMetricsPlugin } from "api-shared/operation-metrics";
import { ddb, TABLE_NAME, PK } from "./lib/aws/ddb";
import type { Context } from "./context";

const server = new ApolloServer<Context>({
  typeDefs,
  resolvers,
  introspection: true,
  plugins: [
    // pantry keeps everything under a single pk ("PANTRY", see PK) and
    // varies only the sk prefix per item type - "STATS#OP#" here matches
    // that convention rather than introducing a dedicated "STATS" pk.
    createOperationMetricsPlugin<Context>({
      project: "pantry",
      ddb,
      tableName: TABLE_NAME,
      pk: PK,
      skPrefix: "STATS#OP#",
    }),
  ],
});

const apolloHandler = startServerAndCreateLambdaHandler(
  server,
  handlers.createAPIGatewayProxyEventV2RequestHandler(),
  {
    context: async ({ event }) => ({
      sourceIp: event.requestContext?.http?.sourceIp,
      // Captured synchronously, as early as possible in the invocation -
      // see xray.ts's traced() for why this can't be looked up later.
      xraySegment: process.env.AWS_LAMBDA_FUNCTION_NAME ? AWSXRay.getSegment() : undefined,
    }),
  }
);

// The warmup schedule invokes this function directly (bypassing API
// Gateway) with a fixed {warmup: true} payload - short-circuit before
// Apollo ever sees it, so a scheduled ping never resolves a real query or
// touches DynamoDB.
export const handler = async (
  event: APIGatewayProxyEventV2 | WarmupPing,
  context: LambdaContext
): Promise<APIGatewayProxyStructuredResultV2 | void> => {
  if (isWarmupPing(event)) return { statusCode: 200, body: "warm" };

  return apolloHandler(event, context, () => {});
};
