import { ApolloServer } from "@apollo/server";
import { startServerAndCreateLambdaHandler, handlers } from "@as-integrations/aws-lambda";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { parse } from "graphql";
import * as AWSXRay from "aws-xray-sdk-core";
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context as LambdaContext } from "aws-lambda";
import { typeDefs } from "./schema";
import { resolvers } from "./resolvers/resolvers";
import { createOperationMetricsPlugin } from "api-shared/operation-metrics";
import { corsHeaders } from "api-shared/http";
import { ddb, TABLE_NAME, PK } from "./lib/aws/ddb";
import type { Context } from "./context";

const server = new ApolloServer<Context>({
  schema: buildSubgraphSchema([{ typeDefs: parse(typeDefs), resolvers }]),
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
  handlers.createAPIGatewayProxyEventRequestHandler(),
  {
    context: async ({ event }) => ({
      sourceIp: event.requestContext?.identity?.sourceIp,
      // Captured synchronously, as early as possible in the invocation -
      // see xray.ts's traced() for why this can't be looked up later.
      xraySegment: process.env.AWS_LAMBDA_FUNCTION_NAME ? AWSXRay.getSegment() : undefined,
    }),
  }
);

export const handler = async (
  event: APIGatewayProxyEvent,
  context: LambdaContext
): Promise<APIGatewayProxyResult | void> => {
  const result = await apolloHandler(event, context, () => {});
  if (!result) return result;

  return { ...result, headers: { ...result.headers, ...corsHeaders(event.headers?.origin) } };
};
