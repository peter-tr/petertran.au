import { ApolloServer } from "@apollo/server";
import { startServerAndCreateLambdaHandler, handlers } from "@as-integrations/aws-lambda";
import {
  ApolloGateway,
  RemoteGraphQLDataSource,
  type GraphQLDataSourceProcessOptions,
} from "@apollo/gateway";
import * as AWSXRay from "aws-xray-sdk-core";
import { traced, traceHeader } from "api-shared/xray";
import { corsHeaders } from "api-shared/http";
import type { Context as SharedContext } from "api-shared/context";
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context as LambdaContext } from "aws-lambda";
import { SUPERGRAPH_SDL } from "./supergraph.generated";

const apiBaseUrl = process.env.API_BASE_URL;
if (!apiBaseUrl) throw new Error("API_BASE_URL is required");

// Carries the client's own authorization header through to whichever
// subgraph the gateway fans a request out to (pantry's is the only subgraph
// that reads it today - see cognito-auth.ts) - RemoteGraphQLDataSource
// doesn't forward the original request's headers on its own, only what
// willSendRequest below explicitly copies from context.
interface Context extends SharedContext {
  authorization?: string;
}

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
    if (context.authorization) request.http?.headers.set("authorization", context.authorization);
  }
}

const gateway = new ApolloGateway({
  // Composed at build time (see scripts/compose-supergraph.ts), not via
  // IntrospectAndCompose - that used to fetch all subgraphs' SDL over
  // HTTPS on every cold start, which was the dominant cost in the gateway's
  // cold-start latency.
  supergraphSdl: SUPERGRAPH_SDL,
  // Ignores the `url` composed into the schema (a build-time placeholder,
  // see compose-supergraph.ts) and reconstructs the real per-environment URL
  // from `name` instead - the same composed artifact is deployed to both
  // prod and the test env, only apiBaseUrl differs between them.
  buildService: ({ name }) => new TracedDataSource(name, `${apiBaseUrl}/${name}`),
});

const server = new ApolloServer<Context>({ gateway, introspection: true });

const apolloHandler = startServerAndCreateLambdaHandler(
  server,
  handlers.createAPIGatewayProxyEventRequestHandler(),
  {
    context: async ({ event }) => ({
      // Captured synchronously, as early as possible in the invocation -
      // see xray.ts's traced() for why this can't be looked up later.
      xraySegment: process.env.AWS_LAMBDA_FUNCTION_NAME ? AWSXRay.getSegment() : undefined,
      // API Gateway lower-cases header names for a Lambda proxy integration,
      // but this handler type is shared code, not something worth trusting
      // that invariant for - check both cases.
      authorization: event.headers?.authorization ?? event.headers?.Authorization,
    }),
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
