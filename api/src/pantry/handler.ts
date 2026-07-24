import { ApolloServer } from "@apollo/server";
import { startServerAndCreateLambdaHandler, handlers } from "@as-integrations/aws-lambda";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { parse } from "graphql";
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context as LambdaContext } from "aws-lambda";
import { typeDefs } from "./schema";
import { resolvers } from "./resolvers/resolvers";
import { createOperationMetricsPlugin } from "api-shared/operation-metrics";
import { corsHeaders } from "api-shared/http";
import { createCognitoAuthVerifier } from "api-shared/cognito-auth";
import { ddb, TABLE_NAME } from "./lib/aws/ddb";
import { DEFAULT_PK, pkForUser, type Context } from "./context";

// Metrics keep living under the default/shared pantry's pk regardless of who
// made the call - per-user operation metrics aren't worth the extra
// dimension for a personal project, and this predates multi-user support.
const OPERATION_METRICS_PK = DEFAULT_PK;

const verifyIdToken = createCognitoAuthVerifier({
  userPoolId: process.env.PANTRY_COGNITO_USER_POOL_ID ?? "",
  clientId: process.env.PANTRY_COGNITO_CLIENT_ID ?? "",
});

const server = new ApolloServer<Context>({
  schema: buildSubgraphSchema([{ typeDefs: parse(typeDefs), resolvers }]),
  introspection: true,
  plugins: [
    // pantry keeps everything under a single pk per item type - "STATS#OP#"
    // here matches that convention rather than introducing a dedicated
    // "STATS" pk.
    createOperationMetricsPlugin<Context>({
      project: "pantry",
      ddb,
      tableName: TABLE_NAME,
      pk: OPERATION_METRICS_PK,
      skPrefix: "STATS#OP#",
    }),
  ],
});

const apolloHandler = startServerAndCreateLambdaHandler(
  server,
  handlers.createAPIGatewayProxyEventRequestHandler(),
  {
    context: async ({ event }) => {
      // Header lookup is case-insensitive - API Gateway REST API doesn't
      // normalize casing in event.headers the way HTTP API does.
      const authHeader = Object.entries(event.headers ?? {}).find(
        ([key]) => key.toLowerCase() === "authorization"
      )?.[1];
      const user = await verifyIdToken(authHeader);

      return {
        sourceIp: event.requestContext?.identity?.sourceIp,
        pantryPk: pkForUser(user?.sub ?? null),
        userId: user?.sub ?? null,
        email: user?.email ?? null,
      };
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
