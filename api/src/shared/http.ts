// Lambda Function URLs base64-encode the request body under some conditions
// (observed with a plain curl -d POST, isBase64Encoded: true) - JSON.parse
// on the raw event.body then fails with "Unexpected token 'e'" (the start of
// the base64 string itself). Always check the flag rather than assuming.
//
// `body` accepts `null` (not just `undefined`) so this works for both
// APIGatewayProxyEvent (REST API, `body: string | null`) and
// APIGatewayProxyEventV2 (HTTP API, `body?: string`).
export function parseJsonBody<T>(event: { body?: string | null; isBase64Encoded?: boolean }): T {
  const raw = event.body ?? "{}";
  const decoded = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf8") : raw;

  return JSON.parse(decoded) as T;
}
