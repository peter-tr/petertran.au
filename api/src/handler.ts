import { ApolloServer } from "@apollo/server";
import { startServerAndCreateLambdaHandler, handlers } from "@as-integrations/aws-lambda";
import { typeDefs } from "./schema";
import { resolvers } from "./resolvers/resolvers";
import { operationStatsPlugin } from "./lib/operation-stats-plugin";
import type { Context } from "./context";

const server = new ApolloServer<Context>({
  typeDefs,
  resolvers,
  introspection: true,
  plugins: [operationStatsPlugin],
});

export const handler = startServerAndCreateLambdaHandler(
  server,
  handlers.createAPIGatewayProxyEventV2RequestHandler(),
  {
    context: async ({ event, context }) => ({
      sourceIp: event.requestContext?.http?.sourceIp,
      functionName: context.functionName,
    }),
  }
);
