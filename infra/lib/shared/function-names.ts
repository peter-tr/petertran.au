// Single source of truth for every Lambda functionName ProvisionedConcurrencyStack
// (infra/lib/warm-schedule-stack.ts) and ApiGatewayStack target. Deliberately
// plain string literals, imported by both the producing stacks (which set
// these as each Lambda's functionName prop) and app.ts (which passes them to
// ProvisionedConcurrencyStack/ApiGatewayStack) - NOT
// read back via `fn.functionName` off the construct object, because that
// getter always returns a CloudFormation token (a Ref to the resource)
// regardless of whether functionName was set to an explicit literal. Passing
// that token cross-stack still creates a real CloudFormation export, which
// is exactly the coupling this whole module exists to avoid - see
// warm-schedule-stack.ts's doc comment.
export const FUNCTION_NAMES = {
  portfolio: "portfolio-graphql",
  pantry: "pantry-graphql",
  imposter: "imposter-graphql",
  ztlIdpBridge: "ztl-idp-bridge",
  ztlInternalSts: "ztl-internal-sts",
  ztlEdgeAuthorizer: "ztl-edge-authorizer",
  ztlEdgeProxy: "ztl-edge-proxy",
  ztlDomainA: "ztl-domain-a",
  warmSchedule: "warm-schedule",
  supergraph: "supergraph-graphql",
} as const;

// Test-env counterparts of the 4 GraphQL Lambda names above, passed to
// SiteStack/PantryStack/GamesStack/SupergraphStack's functionName prop and
// ApiGatewayStack's portfolio/pantry/imposter/supergraphFnName props when
// DEPLOY_TEST_ENV=true (see infra/bin/app.ts). Suffixed so they can never
// collide with the real prod Lambdas they're testing changes against,
// since the test env deploys alongside prod, not instead of it - no
// zero-trust-lab/warm-schedule counterparts, since those aren't part of
// what the test env exists to validate.
export const TEST_FUNCTION_NAMES = {
  portfolio: "portfolio-graphql-test",
  pantry: "pantry-graphql-test",
  imposter: "imposter-graphql-test",
  supergraph: "supergraph-graphql-test",
} as const;

// Alias name portfolio/pantry/imposter each publish a "live" Lambda Alias
// under - the qualifier real traffic (ApiGatewayStack) targets, and the one
// ProvisionedConcurrencyStack's warm-schedule Lambda applies Provisioned
// Concurrency to. Zero-trust-lab and warm-schedule itself have no alias -
// they stay on bare $LATEST.
export const LIVE_ALIAS_NAME = "live";

// `Alias.fromAliasAttributes` needs a live `IVersion` reference, which can't
// be built from a plain function-name string - so cross-stack consumers
// (ApiGatewayStack, ProvisionedConcurrencyStack) instead import the
// qualified ARN directly via `lambda.Function.fromFunctionAttributes`, same
// "plain string, no live construct reference" convention as everywhere else
// in shared/.
export function liveAliasArn(region: string, account: string, functionName: string): string {
  return `arn:aws:lambda:${region}:${account}:function:${functionName}:${LIVE_ALIAS_NAME}`;
}
