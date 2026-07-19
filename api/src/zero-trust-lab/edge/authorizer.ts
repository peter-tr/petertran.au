import type {
  APIGatewayRequestAuthorizerEventV2,
  APIGatewaySimpleAuthorizerWithContextResult,
} from "aws-lambda";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { isWarmupPing, type WarmupPing } from "api-shared/warmup";

const lambda = new LambdaClient({});

const IDP_BRIDGE_URL = process.env.IDP_BRIDGE_URL!;
const INTERNAL_STS_FUNCTION_NAME = process.env.INTERNAL_STS_FUNCTION_NAME!;
const INTERNAL_STS_ISSUER_URL = process.env.INTERNAL_STS_ISSUER_URL!;

export interface EdgeAuthContext {
  jwt: string;
  sub: string;
}

const DENY: APIGatewaySimpleAuthorizerWithContextResult<EdgeAuthContext> = {
  isAuthorized: false,
  context: { jwt: "", sub: "" },
};

function audienceForPath(path: string): string | null {
  if (path.startsWith("/domain-a")) return "domain-a";
  if (path.startsWith("/domain-b")) return "domain-b";
  return null;
}

export async function handler(
  event: APIGatewayRequestAuthorizerEventV2 | WarmupPing
): Promise<APIGatewaySimpleAuthorizerWithContextResult<EdgeAuthContext>> {
  // Checked first - a warmup payload has no `rawPath`, and audienceForPath
  // below would throw on that, not just no-op.
  if (isWarmupPing(event)) return DENY;

  const authHeader = event.headers?.authorization ?? event.headers?.Authorization;
  const opaqueToken = authHeader?.replace(/^Bearer\s+/i, "");
  const audience = audienceForPath(event.rawPath);
  if (!opaqueToken || !audience) return DENY;

  const introspectResp = await fetch(`${IDP_BRIDGE_URL.replace(/\/$/, "")}/introspect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: opaqueToken }),
  });
  if (!introspectResp.ok) return DENY;
  const introspection = (await introspectResp.json()) as { active: boolean; sub?: string; scope?: string };
  if (!introspection.active || !introspection.sub) return DENY;

  const invokeResp = await lambda.send(
    new InvokeCommand({
      FunctionName: INTERNAL_STS_FUNCTION_NAME,
      Payload: Buffer.from(
        JSON.stringify({
          claims: { sub: introspection.sub, scope: introspection.scope },
          audience,
          issuer: INTERNAL_STS_ISSUER_URL,
        })
      ),
    })
  );
  if (!invokeResp.Payload) return DENY;
  const { jwt } = JSON.parse(Buffer.from(invokeResp.Payload).toString("utf8")) as { jwt?: string };
  if (!jwt) return DENY;

  return { isAuthorized: true, context: { jwt, sub: introspection.sub } };
}
