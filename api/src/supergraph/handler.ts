import { ApolloServer } from "@apollo/server";
import { startServerAndCreateLambdaHandler, handlers } from "@as-integrations/aws-lambda";
import { ApolloGateway, IntrospectAndCompose } from "@apollo/gateway";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context as LambdaContext,
} from "aws-lambda";
import { isWarmupPing, type WarmupPing } from "api-shared/warmup";

const apiBaseUrl = process.env.API_BASE_URL;
if (!apiBaseUrl) throw new Error("API_BASE_URL is required");

const gateway = new ApolloGateway({
  supergraphSdl: new IntrospectAndCompose({
    subgraphs: [
      { name: "portfolio", url: `${apiBaseUrl}/portfolio` },
      { name: "pantry", url: `${apiBaseUrl}/pantry` },
      { name: "imposter", url: `${apiBaseUrl}/imposter` },
    ],
    // No pollIntervalInMs, unlike the local dev-server gateway - Lambda
    // freezes between invocations, so an ongoing poll timer serves no
    // purpose here. Composes once per cold start instead.
  }),
});

const server = new ApolloServer({ gateway, introspection: true });

const apolloHandler = startServerAndCreateLambdaHandler(
  server,
  handlers.createAPIGatewayProxyEventV2RequestHandler()
);

// The warmup schedule invokes this function directly (bypassing API
// Gateway) with a fixed {warmup: true} payload - short-circuit before
// Apollo ever sees it, so a scheduled ping never triggers gateway
// composition against the three subgraphs.
export const handler = async (
  event: APIGatewayProxyEventV2 | WarmupPing,
  context: LambdaContext
): Promise<APIGatewayProxyStructuredResultV2 | void> => {
  if (isWarmupPing(event)) return { statusCode: 200, body: "warm" };

  return apolloHandler(event, context, () => {});
};
