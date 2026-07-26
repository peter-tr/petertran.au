import { ApolloServer } from "@apollo/server";
import { ApolloServerPluginInlineTrace } from "@apollo/server/plugin/inlineTrace";
import { startServerAndCreateLambdaHandler, handlers } from "@as-integrations/aws-lambda";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { parse } from "graphql";
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context as LambdaContext } from "aws-lambda";
import { typeDefs } from "./schema";
import { resolvers } from "./resolvers/resolvers";
import { operationStatsPlugin } from "./lib/util/operation-stats-plugin";
import { createResumePartitionLoader } from "./lib/aws/resume-data";
import { corsHeaders } from "api-shared/http";
import type { Context } from "./context";

const server = new ApolloServer<Context>({
  schema: buildSubgraphSchema([{ typeDefs: parse(typeDefs), resolvers }]),
  introspection: true,
  // Responds to the supergraph Router's federated-tracing header with
  // per-field timing data (extensions.ftv1) - without this, Router still
  // reports the operation ran (name, count, latency) to GraphOS Studio,
  // but Studio's field-level Insights stay empty since it never receives
  // the field-by-field breakdown from this subgraph.
  plugins: [operationStatsPlugin, ApolloServerPluginInlineTrace()],
});

const apolloHandler = startServerAndCreateLambdaHandler(
  server,
  handlers.createAPIGatewayProxyEventRequestHandler(),
  {
    context: async ({ event, context }) => {
      const baseContext: Context = {
        sourceIp: event.requestContext?.identity?.sourceIp,
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

export const handler = async (
  event: APIGatewayProxyEvent,
  context: LambdaContext
): Promise<APIGatewayProxyResult | void> => {
  const result = await apolloHandler(event, context, () => {});
  if (!result) return result;

  return { ...result, headers: { ...result.headers, ...corsHeaders(event.headers?.origin) } };
};
