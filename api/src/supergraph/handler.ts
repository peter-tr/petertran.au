import { ApolloServer } from "@apollo/server";
import { startServerAndCreateLambdaHandler, handlers } from "@as-integrations/aws-lambda";
import {
  ApolloGateway,
  IntrospectAndCompose,
  RemoteGraphQLDataSource,
  type GraphQLDataSourceProcessOptions,
} from "@apollo/gateway";
import * as AWSXRay from "aws-xray-sdk-core";
import { traced, traceHeader } from "api-shared/xray";
import type { Context } from "api-shared/context";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context as LambdaContext,
} from "aws-lambda";

const apiBaseUrl = process.env.API_BASE_URL;
if (!apiBaseUrl) throw new Error("API_BASE_URL is required");

// Without this, a subgraph fetch is invisible in X-Ray: ApolloGateway calls
// out over plain HTTPS, not an AWS SDK client, so nothing auto-instruments
// it the way DynamoDB/KMS calls are elsewhere - the whole gateway
// invocation would otherwise show up as one undifferentiated blob with no
// way to tell which subgraph (or the fan-out itself) was slow.
class TracedDataSource extends RemoteGraphQLDataSource<Context> {
  constructor(
    private readonly subgraphName: string,
    url: string
  ) {
    super({ url });
  }

  override process(options: GraphQLDataSourceProcessOptions<Context>) {
    return traced(
      `Subgraph: ${this.subgraphName}`,
      () => super.process(options),
      options.context.xraySegment
    );
  }

  // process() above only gives *local* visibility (a subsegment on the
  // supergraph's own trace) - it doesn't tell the subgraph it's part of the
  // same request. Without this header, each subgraph Lambda starts its own
  // disconnected trace, so X-Ray never shows the supergraph and subgraphs
  // as one connected trace/service map. willSendRequest() is the officially
  // supported hook for mutating the outgoing request, called by
  // super.process() after request.http.headers has already been set up.
  override willSendRequest({ request, context }: GraphQLDataSourceProcessOptions<Context>) {
    for (const [name, value] of Object.entries(traceHeader(context.xraySegment))) {
      request.http?.headers.set(name, value);
    }
  }
}

const gateway = new ApolloGateway({
  supergraphSdl: new IntrospectAndCompose({
    subgraphs: [
      { name: "portfolio", url: `${apiBaseUrl}/portfolio` },
      { name: "pantry", url: `${apiBaseUrl}/pantry` },
      { name: "imposter", url: `${apiBaseUrl}/imposter` },
      { name: "design-studio", url: `${apiBaseUrl}/design-studio` },
    ],
    // No pollIntervalInMs, unlike the local dev-server gateway - Lambda
    // freezes between invocations, so an ongoing poll timer serves no
    // purpose here. Composes once per cold start instead.
  }),
  buildService: ({ name, url }) => new TracedDataSource(name, url!),
});

const server = new ApolloServer<Context>({ gateway, introspection: true });

const apolloHandler = startServerAndCreateLambdaHandler(
  server,
  handlers.createAPIGatewayProxyEventV2RequestHandler(),
  {
    context: async () => ({
      // Captured synchronously, as early as possible in the invocation -
      // see xray.ts's traced() for why this can't be looked up later.
      xraySegment: process.env.AWS_LAMBDA_FUNCTION_NAME ? AWSXRay.getSegment() : undefined,
    }),
  }
);

export const handler = async (
  event: APIGatewayProxyEventV2,
  context: LambdaContext
): Promise<APIGatewayProxyStructuredResultV2 | void> => {
  return apolloHandler(event, context, () => {});
};
