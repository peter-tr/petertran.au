// Published AWS Lambda on-demand pricing for ap-southeast-2 (Sydney) x86,
// where this project's function actually runs (see
// infra/lib/site-stack.ts's GraphQLFunction) - this project's volume never
// gets close to the 6M GB-second Tier 1 ceiling, so Tier 1 always applies.
const PRICE_PER_REQUEST_USD = 0.0000002;
const PRICE_PER_GB_SECOND_USD = 0.0000166667;

// Kept in sync by hand with infra/lib/site-stack.ts's GraphQLFunction
// memorySize - there's no shared config between the CDK and API packages to
// import it from.
const LAMBDA_MEMORY_GB = 256 / 1024;

// Estimates the total Lambda compute + invocation cost of `calls` requests
// that together took `totalDurationMs` - not a real bill line item (AWS
// doesn't meter or report at this granularity), but a direct application of
// AWS's own published formula to numbers this project already measures for
// real. Deliberately excludes DynamoDB, CloudWatch, and Anthropic costs the
// same requests may also incur, since those aren't determined by duration or
// call count alone.
export function estimateLambdaCostUsd(totalDurationMs: number, calls: number): number {
  const gbSeconds = (totalDurationMs / 1000) * LAMBDA_MEMORY_GB;
  return gbSeconds * PRICE_PER_GB_SECOND_USD + calls * PRICE_PER_REQUEST_USD;
}
