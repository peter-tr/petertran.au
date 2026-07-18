import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { isWarmupPing, type WarmupPing } from "@shared/warmup";

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer | WarmupPing
): Promise<APIGatewayProxyStructuredResultV2> {
  if (isWarmupPing(event)) return { statusCode: 200, body: "warm" };

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "hello from domain-a", claims: event.requestContext.authorizer.jwt.claims }),
  };
}
