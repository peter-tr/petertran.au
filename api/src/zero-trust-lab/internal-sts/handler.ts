import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { signJwt, getJwks, type JwtClaims } from "../lib/jwt";
import { normalizePath } from "../lib/http";

const KMS_KEY_ID = process.env.KMS_KEY_ID!;
const KID = "zero-trust-lab-key-1";

interface ExchangeRequest {
  claims: { sub: string; scope?: string };
  audience: string;
  // Passed by the caller (EdgeAuthorizerFunction), not read from this
  // function's own env - see the stack's comment on why InternalStsFunction
  // can't hold its own Function URL as an env var (self-referential
  // CloudFormation dependency).
  issuer: string;
}

// A direct Lambda `Invoke` payload (from the edge authorizer) has no
// requestContext; a Function URL request (JWKS/discovery) always does.
function isHttpEvent(event: APIGatewayProxyEventV2 | ExchangeRequest): event is APIGatewayProxyEventV2 {
  return "requestContext" in event;
}

async function handleHttp(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  // Derived from the incoming request itself, not an env var - same
  // self-reference issue as above. A Function URL request always carries
  // its own hostname, which is exactly this function's issuer identifier.
  const issuerUrl = `https://${event.requestContext.domainName}/`;

  switch (normalizePath(event.rawPath)) {
    case "/.well-known/jwks.json": {
      const jwks = await getJwks(KMS_KEY_ID, KID);

      return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(jwks) };
    }
    case "/.well-known/openid-configuration": {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ issuer: issuerUrl, jwks_uri: `${issuerUrl}.well-known/jwks.json` }),
      };
    }
    default:
      return { statusCode: 404, body: "not found" };
  }
}

async function handleExchange(request: ExchangeRequest): Promise<{ jwt: string }> {
  const claims: JwtClaims = {
    sub: request.claims.sub,
    scope: request.claims.scope,
    aud: request.audience,
    iss: request.issuer,
  };

  return { jwt: await signJwt(claims, KMS_KEY_ID, KID) };
}

export async function handler(
  event: APIGatewayProxyEventV2 | ExchangeRequest
): Promise<APIGatewayProxyStructuredResultV2 | { jwt: string }> {
  if (isHttpEvent(event)) return handleHttp(event);

  return handleExchange(event);
}
