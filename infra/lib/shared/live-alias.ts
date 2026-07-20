import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { LIVE_ALIAS_NAME } from "./function-names";

// Publishes the "live" alias every project's Lambda gets pinned to - the
// qualifier ApiGatewayStack/WarmupStack target and ProvisionedConcurrencyStack
// applies PC to (see LIVE_ALIAS_NAME's doc comment). `id` is the alias
// construct's own CDK id (e.g. "LiveAlias", "IdpBridgeLiveAlias") - left
// explicit per call site so existing CloudFormation logical ids don't shift.
export function createLiveAlias(scope: Construct, id: string, fn: lambda.Function): lambda.Alias {
  return new lambda.Alias(scope, id, {
    aliasName: LIVE_ALIAS_NAME,
    version: fn.currentVersion,
  });
}
