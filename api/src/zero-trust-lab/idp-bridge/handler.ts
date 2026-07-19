import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { PutCommand, GetCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import {
  CognitoIdentityProviderClient,
  ListUserPoolClientsCommand,
  DescribeUserPoolClientCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { createDdbClient } from "api-shared/ddb";
import { generateOpaqueToken } from "../lib/opaque-token";
import { normalizePath } from "../lib/http";
import { parseJsonBody } from "api-shared/http";
import { isWarmupPing, type WarmupPing } from "api-shared/warmup";

const { ddb, TABLE_NAME } = createDdbClient({ defaultTableName: "ZeroTrustSessions" });
const cognito = new CognitoIdentityProviderClient({});

const COGNITO_DOMAIN = process.env.COGNITO_DOMAIN!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

// Long-lived deliberately - this is the lab's actual "session". The one
// interactive Cognito login mints this once; everything after that is
// silent until it's revoked (/logout) or this TTL elapses.
const OPAQUE_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 365;

function decodeIdTokenClaims(idToken: string): { sub: string; email?: string } {
  // Not verifying the signature here is a deliberate, safe simplification:
  // this id_token just came directly from Cognito's own token endpoint over
  // HTTPS in the previous line, not from an untrusted client - there's
  // nothing to verify it against that we don't already trust.
  const payload = idToken.split(".")[1];

  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

// Looked up at runtime rather than passed in as an env var - wiring the
// UserPoolClient's id/secret into this function's own environment would
// create a CloudFormation circular dependency, since UserPoolClient's
// callbackUrls already depends on this function's Function URL. Cached
// across warm invocations so it's not a Cognito API round trip every
// request. Only one app client exists in this pool, so there's nothing to
// disambiguate.
let cachedClientCredentials: { clientId: string; clientSecret: string } | undefined;

async function getClientCredentials(): Promise<{ clientId: string; clientSecret: string }> {
  if (cachedClientCredentials) return cachedClientCredentials;

  const { UserPoolClients } = await cognito.send(
    new ListUserPoolClientsCommand({ UserPoolId: USER_POOL_ID, MaxResults: 1 })
  );
  const clientId = UserPoolClients?.[0]?.ClientId;
  if (!clientId) throw new Error("no Cognito app client found in user pool");

  const { UserPoolClient: client } = await cognito.send(
    new DescribeUserPoolClientCommand({ UserPoolId: USER_POOL_ID, ClientId: clientId })
  );
  const clientSecret = client?.ClientSecret;
  if (!clientSecret) throw new Error("Cognito app client has no secret");

  cachedClientCredentials = { clientId, clientSecret };

  return cachedClientCredentials;
}

async function handleCallback(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const code = event.queryStringParameters?.code;
  if (!code) return { statusCode: 400, body: "missing code" };

  const { clientId, clientSecret } = await getClientCredentials();
  // Derived from the incoming request rather than an env var, for the same
  // circular-dependency reason as the client credentials above - this
  // Function URL's own hostname isn't something this function can depend on
  // via CloudFormation. Cognito requires it to match callbackUrls exactly.
  const redirectUri = `https://${event.requestContext.domainName}/callback`;

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokenResp = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basicAuth}` },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenResp.ok) {
    return { statusCode: 502, body: `cognito token exchange failed: ${await tokenResp.text()}` };
  }

  const { id_token: idToken } = (await tokenResp.json()) as { id_token: string };
  const { sub, email } = decodeIdTokenClaims(idToken);

  const opaqueToken = generateOpaqueToken();
  const now = Math.floor(Date.now() / 1000);
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { pk: opaqueToken, sub, email, scope: "read", ttl: now + OPAQUE_TOKEN_TTL_SECONDS },
    })
  );

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ access_token: opaqueToken, token_type: "opaque" }),
  };
}

async function handleIntrospect(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const { token } = parseJsonBody<{ token?: string }>(event);
  if (!token) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: false }),
    };
  }

  const { Item } = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: token } }));
  const now = Math.floor(Date.now() / 1000);
  if (!Item || (Item.ttl as number) < now) {
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: false }),
    };
  }

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ active: true, sub: Item.sub, scope: Item.scope, exp: Item.ttl }),
  };
}

async function handleLogout(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const { token } = parseJsonBody<{ token?: string }>(event);
  if (!token) return { statusCode: 400, body: "missing token" };

  await ddb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { pk: token } }));

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ loggedOut: true }),
  };
}

export async function handler(
  event: APIGatewayProxyEventV2 | WarmupPing
): Promise<APIGatewayProxyStructuredResultV2> {
  if (isWarmupPing(event)) return { statusCode: 200, body: "warm" };

  switch (normalizePath(event.rawPath)) {
    case "/callback":
      return handleCallback(event);
    case "/introspect":
      return handleIntrospect(event);
    case "/logout":
      return handleLogout(event);
    default:
      return { statusCode: 404, body: "not found" };
  }
}
