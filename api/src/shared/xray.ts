import * as AWSXRay from "aws-xray-sdk-core";

// Shared subsegment name for every project's Anthropic call(s), so the trace
// breakdown groups them consistently instead of each project inventing its
// own label.
export const ANTHROPIC_API_SEGMENT_NAME = "Anthropic API";

// Not an AWS SDK call, so X-Ray can't auto-instrument it - wrap it in its own
// subsegment so the trace breakdown shows how much of the latency is actually
// the wrapped call (e.g. Anthropic) vs. our own code. Same Lambda-only guard
// as ddb.ts's captureAWSv3Client usage - there's no active segment to attach
// to outside a real invocation.
export async function traced<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME) return fn();

  return AWSXRay.captureAsyncFunc(name, async (subsegment) => {
    try {
      const res = await fn();
      subsegment?.close();

      return res;
    } catch (err) {
      subsegment?.close(err instanceof Error ? err : undefined);
      throw err;
    }
  });
}
