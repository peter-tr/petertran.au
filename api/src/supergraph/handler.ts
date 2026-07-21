import { ApolloServer } from "@apollo/server";
import { startServerAndCreateLambdaHandler, handlers } from "@as-integrations/aws-lambda";
import { ApolloGateway, IntrospectAndCompose } from "@apollo/gateway";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context as LambdaContext,
} from "aws-lambda";

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

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: LambdaContext
): Promise<APIGatewayProxyStructuredResultV2 | void> => {
  return apolloHandler(event, context, () => {});
};
