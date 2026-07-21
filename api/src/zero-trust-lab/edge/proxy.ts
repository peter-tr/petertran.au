import type {
  APIGatewayProxyEventV2WithLambdaAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import * as AWSXRay from "aws-xray-sdk-core";
import { traced } from "api-shared/xray";
import type { EdgeAuthContext } from "./authorizer";

const DOMAIN_A_URL = process.env.DOMAIN_A_URL!;
const DOMAIN_B_URL = process.env.DOMAIN_B_URL;

export async function handler(
  event: APIGatewayProxyEventV2WithLambdaAuthorizer<EdgeAuthContext>
): Promise<APIGatewayProxyStructuredResultV2> {
  // Captured synchronously, as early as possible in the invocation - see
  // xray.ts's traced() for why this can't be looked up later.
  const xraySegment = process.env.AWS_LAMBDA_FUNCTION_NAME ? AWSXRay.getSegment() : undefined;

  const { jwt } = event.requestContext.authorizer.lambda;

  const [prefix, ...rest] = event.rawPath.split("/").filter(Boolean);
  const targetBase = prefix === "domain-a" ? DOMAIN_A_URL : prefix === "domain-b" ? DOMAIN_B_URL : undefined;
  if (!targetBase) return { statusCode: 404, body: "unknown domain" };

  const targetUrl = `${targetBase.replace(/\/$/, "")}/${rest.join("/")}`;
  const resp = await traced(
    `Proxy: ${prefix}`,
    () =>
      fetch(targetUrl, {
        method: event.requestContext.http.method,
        headers: { authorization: `Bearer ${jwt}` },
      }),
    xraySegment
  );
  const body = await resp.text();

  return {
    statusCode: resp.status,
    // X-Debug-Jwt is a learning/testing aid only - it lets you copy the
    // minted JWT to manually try it against the *other* domain gateway and
    // watch the audience mismatch get rejected. Not something you'd ship.
    headers: { "content-type": resp.headers.get("content-type") ?? "application/json", "x-debug-jwt": jwt },
    body,
  };
}
