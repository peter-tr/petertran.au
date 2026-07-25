import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";

let cachedClient: AnthropicBedrock | null = null;

// No Secrets Manager fetch needed here, unlike getAnthropicClient() - the
// Bedrock SDK authenticates via the Lambda execution role's AWS credentials
// (the standard AWS SDK credential chain), not an API key.
//
// The fallback only matters for local dev/scripts - Lambda always sets
// AWS_REGION itself. Every Lambda in this repo deploys to ap-southeast-2
// (see infra/bin/*.ts), so that's the fallback, not AWS's more common
// us-east-1 default - a caller relying on the fallback locally needs a
// region that actually has the same Bedrock inference profiles (e.g.
// "au.anthropic.claude-sonnet-4-6") the deployed Lambda uses.
export function getAnthropicBedrockClient(): AnthropicBedrock {
  cachedClient ??= new AnthropicBedrock({ awsRegion: process.env.AWS_REGION ?? "ap-southeast-2" });

  return cachedClient;
}
