import type Anthropic from "@anthropic-ai/sdk";
import type { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import { getAnthropicClient } from "./anthropic-client";
import { getAnthropicBedrockClient } from "./anthropic-bedrock-client";

export type AiProvider = "ANTHROPIC" | "BEDROCK";
export type AiModelTier = "HAIKU" | "SONNET";

// Bedrock's inference-profile IDs don't match the direct API's bare model
// IDs for the same model, so callers pick a capability tier rather than a
// raw ID, and this resolves the actual string per provider. The BEDROCK
// IDs use the "au." cross-region inference profile prefix, not "us." -
// every Lambda in this repo deploys to ap-southeast-2 (see
// infra/bin/app.ts), and on-demand invocation of the bare model id fails
// there the same way it does everywhere else.
//
// BEDROCK + HAIKU is deliberately not offered by any caller (see
// assertValidAiSettings below) - confirmed via a minimal repro that
// Bedrock rejects structured JSON output (output_config.format) for
// Haiku 4.5 with "Extra inputs are not permitted", while the identical
// shape against Sonnet 4.6 on Bedrock succeeds.
export const AI_MODEL_IDS: Record<AiProvider, Record<AiModelTier, string>> = {
  ANTHROPIC: {
    HAIKU: "claude-haiku-4-5",
    SONNET: "claude-sonnet-4-6",
  },
  BEDROCK: {
    HAIKU: "au.anthropic.claude-haiku-4-5-20251001-v1:0",
    SONNET: "au.anthropic.claude-sonnet-4-6",
  },
};

export function resolveAiModel(provider: AiProvider, modelTier: AiModelTier): string {
  return AI_MODEL_IDS[provider][modelTier];
}

// Throws with a user-facing message instead of letting Bedrock's raw 400
// through - see AI_MODEL_IDS's comment for why this combination fails.
// Callers should also disable HAIKU in the UI whenever BEDROCK is
// selected; this is the server-side backstop for a stale client or a
// direct API call.
export function assertValidAiSettings(provider: AiProvider, modelTier: AiModelTier): void {
  if (provider === "BEDROCK" && modelTier === "HAIKU") {
    throw new Error(
      "Bedrock doesn't currently support structured output for Haiku 4.5 - pick Sonnet, or switch to the direct Anthropic API."
    );
  }
}

// No Secrets Manager fetch on the Bedrock path (auths via the Lambda
// execution role instead), so this is only async because ANTHROPIC is.
export async function getAiClient(provider: AiProvider): Promise<Anthropic | AnthropicBedrock> {
  return provider === "BEDROCK" ? getAnthropicBedrockClient() : await getAnthropicClient();
}
