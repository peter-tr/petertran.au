import { ApolloServer } from "@apollo/server";
import { startServerAndCreateLambdaHandler, handlers } from "@as-integrations/aws-lambda";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Context as LambdaContext } from "aws-lambda";
import { typeDefs } from "./schema";
import { resolvers } from "./resolvers/resolvers";
import { operationStatsPlugin } from "./lib/util/operation-stats-plugin";
import { createResumePartitionLoader } from "./lib/aws/resume-data";
import { isWarmupPing, type WarmupPing } from "@shared/warmup";
import type { Context } from "./context";

const server = new ApolloServer<Context>({
  typeDefs,
  resolvers,
  introspection: true,
  plugins: [operationStatsPlugin],
});

const apolloHandler = startServerAndCreateLambdaHandler(
  server,
  handlers.createAPIGatewayProxyEventV2RequestHandler(),
  {
    context: async ({ event, context }) => {
      const baseContext: Context = {
        sourceIp: event.requestContext?.http?.sourceIp,
        userAgent: event.headers?.["user-agent"],
        functionName: context.functionName,
        getResumePartition: createResumePartitionLoader(),
        runInternalQuery: async (query: string) => {
          const res = await server.executeOperation({ query }, { contextValue: baseContext });
          if (res.body.kind !== "single") {
            return { data: null, errors: ["Unexpected multi-part GraphQL response."] };
          }
          const { data, errors } = res.body.singleResult;
          return {
            data: (data ?? null) as Record<string, unknown> | null,
            errors: errors?.map((e) => e.message),
          };
        },
      };
      return baseContext;
    },
  }
);

// The warmup schedule invokes this function directly (bypassing API
// Gateway) with a fixed {warmup: true} payload - short-circuit before
// Apollo ever sees it, so a scheduled ping never resolves a real query or
// touches DynamoDB/Anthropic.
export const handler = async (
  event: APIGatewayProxyEventV2 | WarmupPing,
  context: LambdaContext
): Promise<APIGatewayProxyStructuredResultV2 | void> => {
  if (isWarmupPing(event)) return { statusCode: 200, body: "warm" };
  return apolloHandler(event, context, () => {});
};
