import type {
  APIGatewayProxyEventV2WithLambdaAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import type { EdgeAuthContext } from "./authorizer";
import { isWarmupPing, type WarmupPing } from "@shared/warmup";

const DOMAIN_A_URL = process.env.DOMAIN_A_URL!;
const DOMAIN_B_URL = process.env.DOMAIN_B_URL;

export async function handler(
  event: APIGatewayProxyEventV2WithLambdaAuthorizer<EdgeAuthContext> | WarmupPing
): Promise<APIGatewayProxyStructuredResultV2> {
  // Checked first - a warmup payload has no requestContext, and destructuring
  // it below would throw, not just no-op.
  if (isWarmupPing(event)) return { statusCode: 200, body: "warm" };

  const { jwt } = event.requestContext.authorizer.lambda;

  const [prefix, ...rest] = event.rawPath.split("/").filter(Boolean);
  const targetBase = prefix === "domain-a" ? DOMAIN_A_URL : prefix === "domain-b" ? DOMAIN_B_URL : undefined;
  if (!targetBase) return { statusCode: 404, body: "unknown domain" };

  const targetUrl = `${targetBase.replace(/\/$/, "")}/${rest.join("/")}`;
  const resp = await fetch(targetUrl, {
    method: event.requestContext.http.method,
    headers: { authorization: `Bearer ${jwt}` },
  });
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
