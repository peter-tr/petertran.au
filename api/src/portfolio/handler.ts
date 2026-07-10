import { ApolloServer } from "@apollo/server";
import { startServerAndCreateLambdaHandler, handlers } from "@as-integrations/aws-lambda";
import { typeDefs } from "./schema";
import { resolvers } from "./resolvers/resolvers";
import { operationStatsPlugin } from "./lib/util/operation-stats-plugin";
import { createResumePartitionLoader } from "./lib/aws/resume-data";
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
      userAgent: event.headers?.["user-agent"],
      functionName: context.functionName,
      getResumePartition: createResumePartitionLoader(),
    }),
  }
);
