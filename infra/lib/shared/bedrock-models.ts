// The models any project's AiProvider/AiModelTier setting can select on the
// Bedrock path (see api/src/shared/ai-provider.ts's AI_MODEL_IDS - this list
// must stay in sync with its BEDROCK row).
export const BEDROCK_MODELS = ["anthropic.claude-haiku-4-5-20251001-v1:0", "anthropic.claude-sonnet-4-6"];

// "au." cross-region inference profiles route to both of these regions
// regardless of which region the Lambda itself runs in (confirmed via
// `aws bedrock get-inference-profile`) - granting only the caller's own
// region would let ListFoundationModels succeed but InvokeModel fail
// whenever Bedrock happened to route a request to the other one.
export const BEDROCK_MODEL_REGIONS = ["ap-southeast-2", "ap-southeast-4"];

// Resource ARNs for a bedrock:InvokeModel*-style PolicyStatement covering
// every model in BEDROCK_MODELS via the au. cross-region inference profile,
// plus the underlying per-region foundation models each profile can route
// to - Bedrock authorizes against both the profile ARN and whichever
// regional model ARN it ends up dispatching to.
export function bedrockInvokeResources(region: string, account: string): string[] {
  return [
    ...BEDROCK_MODELS.map((model) => `arn:aws:bedrock:${region}:${account}:inference-profile/au.${model}`),
    ...BEDROCK_MODEL_REGIONS.flatMap((r) =>
      BEDROCK_MODELS.map((model) => `arn:aws:bedrock:${r}::foundation-model/${model}`)
    ),
  ];
}
