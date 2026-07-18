import { ApolloServer } from "@apollo/server";
import { startServerAndCreateLambdaHandler, handlers } from "@as-integrations/aws-lambda";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Context as LambdaContext } from "aws-lambda";
import { typeDefs } from "./schema";
import { resolvers } from "./resolvers/resolvers";
import { isWarmupPing, type WarmupPing } from "@shared/warmup";
import type { Context } from "./context";

const server = new ApolloServer<Context>({
  typeDefs,
  resolvers,
  introspection: true,
});

const apolloHandler = startServerAndCreateLambdaHandler(
  server,
  handlers.createAPIGatewayProxyEventV2RequestHandler(),
  {
    context: async ({ event }) => ({
      sourceIp: event.requestContext?.http?.sourceIp,
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
