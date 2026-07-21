import { ApolloServer } from "@apollo/server";
import { startServerAndCreateLambdaHandler, handlers } from "@as-integrations/aws-lambda";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { parse } from "graphql";
import * as AWSXRay from "aws-xray-sdk-core";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context as LambdaContext,
} from "aws-lambda";
import { typeDefs } from "./schema";
import { createImposterResolvers } from "./resolvers/resolvers";
import { DynamoImposterStore } from "./lib/aws/store";
import { DynamoImposterStatsTracker } from "./lib/aws/stats";
import { createOperationMetricsPlugin } from "api-shared/operation-metrics";
import { ddb, TABLE_NAME } from "./lib/aws/ddb";
import type { Context } from "./context";

const resolvers = createImposterResolvers(new DynamoImposterStore(), new DynamoImposterStatsTracker());

const server = new ApolloServer<Context>({
  schema: buildSubgraphSchema([{ typeDefs: parse(typeDefs), resolvers }]),
  introspection: true,
  // "STATS" pk matches lib/aws/stats.ts's existing game-stats convention.
  plugins: [
    createOperationMetricsPlugin<Context>({ project: "imposter", ddb, tableName: TABLE_NAME, pk: "STATS" }),
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

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: LambdaContext
): Promise<APIGatewayProxyStructuredResultV2 | void> => {
  return apolloHandler(event, context, () => {});
};
