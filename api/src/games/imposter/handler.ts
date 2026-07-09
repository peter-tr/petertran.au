import { ApolloServer } from "@apollo/server";
import { startServerAndCreateLambdaHandler, handlers } from "@as-integrations/aws-lambda";
import { typeDefs } from "./schema";
import { createImposterResolvers } from "./resolvers/resolvers";
import { getGame, putGame, createGameWithUniqueId } from "./lib/aws/store";
import { recordGameCreated, recordGameCompleted, getImposterStats } from "./lib/aws/stats";
import type { Context } from "./context";

const resolvers = createImposterResolvers(
  { getGame, saveGame: putGame, createGame: createGameWithUniqueId },
  { recordGameCreated, recordGameCompleted, getStats: getImposterStats }
);

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
