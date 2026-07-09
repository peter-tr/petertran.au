import { ApolloServer } from "@apollo/server";
import { startServerAndCreateLambdaHandler, handlers } from "@as-integrations/aws-lambda";
import { typeDefs } from "./schema";
import { resolvers } from "./resolvers/resolvers";
import type { Context } from "./context";

const server = new ApolloServer<Context>({
  typeDefs,
  resolvers,
  introspection: true,
});

export const handler = startServerAndCreateLambdaHandler(
  server,
  handlers.createAPIGatewayProxyEventV2RequestHandler(),
  {
    context: async ({ event }) => ({
      sourceIp: event.requestContext?.http?.sourceIp,
    }),
  }
);
