import { ApolloServer } from "@apollo/server";
import { startServerAndCreateLambdaHandler, handlers } from "@as-integrations/aws-lambda";
import { typeDefs } from "./schema.js";
import { resolvers } from "./resolvers.js";
import type { Context } from "./context.js";

const server = new ApolloServer<Context>({
  typeDefs,
  resolvers,
  introspection: true,
});

export const handler = startServerAndCreateLambdaHandler(
  server,
  handlers.createAPIGatewayProxyEventV2RequestHandler(),
  {
    context: async ({ event }) => ({ sourceIp: event.requestContext?.http?.sourceIp }),
  }
);
