import * as AWSXRay from "aws-xray-sdk-core";
import type { SegmentLike } from "aws-xray-sdk-core";

// Shared subsegment name for every project's Anthropic call(s), so the trace
// breakdown groups them consistently instead of each project inventing its
// own label.
export const ANTHROPIC_API_SEGMENT_NAME = "Anthropic API";

// Not an AWS SDK call, so X-Ray can't auto-instrument it - wrap it in its own
// subsegment so the trace breakdown shows how much of the latency is actually
// the wrapped call (e.g. Anthropic) vs. our own code.
//
// Deliberately NOT using AWSXRay.captureAsyncFunc() here. In "automatic"
// mode (the SDK's default), its parent-resolution ignores any explicit
// parent you pass it and always falls back to an ambient lookup via
// cls-hooked (continuation-local-storage over async_hooks) - see
// node_modules/aws-xray-sdk-core/dist/lib/context_utils.js's
// resolveSegment(). That ambient lookup is what silently drops subsegments:
// once a request has a few real `await`s behind it (a rate-limit check, a
// couple of DynamoDB reads, then the Anthropic call), cls-hooked's context
// has reliably gone missing by the time this runs, captureAsyncFunc logs a
// swallowed warning (no logger is configured, so it's invisible) and just
// runs `fn()` unwrapped - confirmed live: real Anthropic calls succeeded
// but produced zero "Anthropic API" subsegments in the actual trace.
//
// Passing the parent segment in explicitly and calling
// `parent.addNewSubsegment()` ourselves sidesteps cls-hooked entirely, so it
// can't drift. The caller is responsible for capturing that segment once,
// early - see Context.xraySegment - rather than us trying to look it up
// here, which is exactly the unreliable thing this avoids.
export async function traced<T>(name: string, fn: () => Promise<T>, parentSegment?: SegmentLike): Promise<T> {
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME) return fn();

  const parent = parentSegment ?? AWSXRay.getSegment();
  if (!parent) return fn();

  const subsegment = parent.addNewSubsegment(name);
  try {
    const res = await fn();
    subsegment.close();

    return res;
  } catch (err) {
    subsegment.close(err instanceof Error ? err : undefined);
    throw err;
  }
}

// Wraps an AWS SDK v3 client so its calls show up as X-Ray subsegments -
// same guard as traced() above: outside Lambda (e.g. local dev) there's no
// daemon/segment to attach to, so this is a no-op there.
export function captureAwsClient<T extends Parameters<typeof AWSXRay.captureAWSv3Client>[0]>(client: T): T {
  return process.env.AWS_LAMBDA_FUNCTION_NAME ? AWSXRay.captureAWSv3Client(client) : client;
}

// Builds the header AWS's X-Ray integration uses to continue a trace across
// an HTTP call to another one of our own Lambdas (a Function URL call isn't
// an AWS SDK call, so nothing auto-attaches this the way captureAwsClient
// does for DynamoDB/KMS - and traced() above only creates a *local*
// subsegment, it never touches the outgoing request). Without this header,
// the downstream Lambda has no way to know it's part of the same request,
// so its own segment starts a brand new, disconnected trace and X-Ray never
// shows the two services as connected - see supergraph/handler.ts's
// TracedDataSource and zero-trust-lab/edge/proxy.ts.
//
// Mirrors the header aws-xray-sdk-core's own captureHTTPsGlobal() would set
// (see node_modules/aws-xray-sdk-core/dist/lib/patchers/http_p.js) - not
// using that helper directly because it resolves the parent segment via the
// same ambient cls-hooked lookup traced() above deliberately avoids.
export function traceHeader(segment?: SegmentLike): Record<string, string> {
  if (!segment) return {};

  const root = "segment" in segment ? segment.segment : segment;

  return {
    "X-Amzn-Trace-Id": `Root=${root.trace_id};Parent=${segment.id};Sampled=${segment.notTraced ? "0" : "1"}`,
  };
}
