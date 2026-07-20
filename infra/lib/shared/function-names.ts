// Single source of truth for every Lambda functionName WarmupStack and
// ApiGatewayStack target. Deliberately plain string literals, imported by
// both the producing stacks (which set these as each Lambda's functionName
// prop) and app.ts (which passes them to WarmupStack/ApiGatewayStack) - NOT
// read back via `fn.functionName` off the construct object, because that
// getter always returns a CloudFormation token (a Ref to the resource)
// regardless of whether functionName was set to an explicit literal. Passing
// that token cross-stack still creates a real CloudFormation export, which
// is exactly the coupling this whole module exists to avoid - see
// warmup-stack.ts's doc comment.
export const FUNCTION_NAMES = {
  portfolio: "portfolio-graphql",
  pantry: "pantry-graphql",
  imposter: "imposter-graphql",
  ztlIdpBridge: "ztl-idp-bridge",
  ztlInternalSts: "ztl-internal-sts",
  ztlEdgeAuthorizer: "ztl-edge-authorizer",
  ztlEdgeProxy: "ztl-edge-proxy",
  ztlDomainA: "ztl-domain-a",
  warmupConfig: "warmup-config",
  pcConfig: "pc-config",
} as const;

// Alias name portfolio/pantry/imposter each publish a "live" Lambda Alias
// under - the qualifier real traffic (ApiGatewayStack) and warmup pings
// (WarmupStack) both target, and the one ProvisionedConcurrencyStack's
// pc-config Lambda applies Provisioned Concurrency to. Zero-trust-lab and
// warmup-config have no alias - they stay on bare $LATEST.
export const LIVE_ALIAS_NAME = "live";

// `Alias.fromAliasAttributes` needs a live `IVersion` reference, which can't
// be built from a plain function-name string - so cross-stack consumers
// (ApiGatewayStack, WarmupStack) instead import the qualified ARN directly
// via `lambda.Function.fromFunctionAttributes`, same "plain string, no live
// construct reference" convention as everywhere else in shared/.
export function liveAliasArn(region: string, account: string, functionName: string): string {
  return `arn:aws:lambda:${region}:${account}:function:${functionName}:${LIVE_ALIAS_NAME}`;
}
