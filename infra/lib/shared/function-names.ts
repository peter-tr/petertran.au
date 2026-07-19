// Single source of truth for every Lambda functionName WarmupStack targets.
// Deliberately plain string literals, imported by both the producing stacks
// (which set these as each Lambda's functionName prop) and app.ts (which
// passes them to WarmupStack) - NOT read back via `fn.functionName` off the
// construct object, because that getter always returns a CloudFormation
// token (a Ref to the resource) regardless of whether functionName was set
// to an explicit literal. Passing that token cross-stack still creates a
// real CloudFormation export, which is exactly the coupling this whole
// module exists to avoid - see warmup-stack.ts's doc comment.
export const FUNCTION_NAMES = {
  portfolio: "portfolio-graphql",
  pantry: "pantry-graphql",
  imposter: "imposter-graphql",
  ztlIdpBridge: "ztl-idp-bridge",
  ztlInternalSts: "ztl-internal-sts",
  ztlEdgeAuthorizer: "ztl-edge-authorizer",
  ztlEdgeProxy: "ztl-edge-proxy",
  ztlDomainA: "ztl-domain-a",
} as const;
