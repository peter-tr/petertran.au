import { AwsRum, type AwsRumConfig } from "aws-rum-web";

const REGION = "ap-southeast-2";
const APPLICATION_VERSION = "1.0.0";

let rumClient: AwsRum | undefined;

/**
 * No-ops outside production builds (no APP_MONITOR_ID/IDENTITY_POOL_ID
 * locally) and swallows init errors per AWS's own guidance - a RUM outage
 * or ad-blocker should never be able to break the site itself.
 */
export function initRum(): void {
  const applicationId = import.meta.env.VITE_RUM_APP_MONITOR_ID;
  const identityPoolId = import.meta.env.VITE_RUM_IDENTITY_POOL_ID;
  const graphqlEndpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT;
  if (!applicationId || !identityPoolId || !graphqlEndpoint) return;

  try {
    // Same origin for every one of this env's *_GRAPHQL_ENDPOINT vars (see
    // web/.env.production/.env.test/.env.development) - reading it from
    // config here instead of hardcoding the prod domain so this keeps
    // matching if RUM is ever pointed at a non-prod environment too.
    const apiOrigin = new URL(graphqlEndpoint).origin;

    const config: AwsRumConfig = {
      identityPoolId,
      allowCookies: true,
      sessionSampleRate: 1,
      telemetries: [
        "errors",
        "performance",
        [
          "http",
          {
            // recordAllRequests: the default (false) only records an
            // http_event for a non-2xx response - useless for this app,
            // since every GraphQL call returns 200 even when the response
            // body's `errors` array is populated. true records every
            // request, so latency and volume per operation actually show up
            // in RUM.
            recordAllRequests: true,
            // Links each RUM-recorded fetch to the X-Ray trace the Lambda
            // behind it produces, by having the client generate the trace ID
            // and send it as an `X-Amzn-Trace-Id` header instead of the
            // Lambda minting an unrelated one on arrival. Scoped to our own
            // API only, not any future third-party fetch this page might make.
            addXRayTraceIdHeader: [new RegExp(`^${apiOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`)],
          },
        ],
      ],
      // Global switch the http plugin's addXRayTraceIdHeader option above
      // checks before it does anything - without this, the matching regex
      // has no effect.
      enableXRay: true,
      // aws-rum-web's own default config pre-populates `endpoint` to the
      // us-west-2 dataplane URL, and that populated value wins over the
      // `region` constructor arg during its internal config merge unless
      // overridden explicitly here - passing `region` alone silently sends
      // every event to the wrong region (403s, since the guest role/app
      // monitor only exist in ap-southeast-2).
      endpoint: `https://dataplane.rum.${REGION}.amazonaws.com`,
    };
    rumClient = new AwsRum(applicationId, APPLICATION_VERSION, REGION, config);
  } catch {
    // Ignore errors thrown during CloudWatch RUM web client initialization
  }
}

/**
 * Manually reports an error to RUM's `errors` telemetry. Needed for GraphQL
 * errors specifically: Apollo Server returns HTTP 200 with an `errors` array
 * even when the operation failed, so RUM's automatic fetch instrumentation
 * (which only look at HTTP status) never sees these as failures on its own.
 */
export function recordRumError(error: unknown): void {
  rumClient?.recordError(error);
}
