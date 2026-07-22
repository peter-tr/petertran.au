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

// infra/lib/api-gateway-stack.ts's defaultCorsPreflightOptions only answers
// the browser's OPTIONS preflight - unlike the HttpApi this stack replaced,
// API Gateway REST API does not add CORS headers to the actual GET/POST
// response coming back through a Lambda proxy integration, so every handler
// behind it has to add them itself. Keep this list in sync with that stack's
// allowOrigins (prod + alternate domains, the on-demand test env's domains,
// and both local dev ports).
const ALLOWED_ORIGINS = [
  "https://www.petertran.au",
  "https://petertran.au",
  "https://test.petertran.au",
  "https://www.test.petertran.au",
  "http://localhost:5173",
  "http://localhost:3000",
];

// Reflects the request's Origin back verbatim (rather than a static "*")
// only when it's on the allow-list, so the browser accepts the actual
// response the same way it already accepted the preflight.
export function corsHeaders(origin: string | undefined): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};

  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}
