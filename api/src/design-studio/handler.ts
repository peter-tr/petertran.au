import { ApolloServer } from "@apollo/server";
import { startServerAndCreateLambdaHandler, handlers } from "@as-integrations/aws-lambda";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { parse } from "graphql";
import * as AWSXRay from "aws-xray-sdk-core";
import { corsHeaders } from "api-shared/http";
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context as LambdaContext } from "aws-lambda";
import { typeDefs } from "./schema";
import { createDesignStudioResolvers } from "./resolvers/resolvers";
import { MongoDesignStore } from "./lib/db/store";
import type { Context } from "./context";

const resolvers = createDesignStudioResolvers(new MongoDesignStore());

const server = new ApolloServer<Context>({
  schema: buildSubgraphSchema([{ typeDefs: parse(typeDefs), resolvers }]),
  introspection: true,
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
