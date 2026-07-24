import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";

// Hardcoded rather than CDK's built-in lambda.AdotLayerVersion.fromJavaScriptSdkLayerVersion()
// helper - that helper's version mapping resolves to the older collector-based ADOT layer
// (account 901920570463), which only ships /opt/otel-handler. Application Signals specifically
// needs /opt/otel-instrument, which only exists in this separately-published layer (account
// 615299751070 - AWS's own account, same one the Lambda console's "Application Signals" toggle
// uses). Confirmed live: deploying the CDK helper's layer with
// AdotLambdaExecWrapper.INSTRUMENT_HANDLER broke every invocation ("/opt/otel-instrument: does
// not exist", Runtime.ExitError) - this ARN was verified directly against AWS (aws lambda
// get-layer-version-by-arn) before use, not copied from a stale doc.
export const APPLICATION_SIGNALS_NODEJS_LAYER_ARN =
  "arn:aws:lambda:ap-southeast-2:615299751070:layer:AWSOpenTelemetryDistroJs:14";

// Attaches everything a Node.js Lambda needs for CloudWatch Application Signals'
// auto-instrumentation (AWS SDK calls, and - via OTEL_NODE_ENABLED_INSTRUMENTATIONS including
// "undici" - outbound fetch calls like the Anthropic SDK's) in place of this codebase's old
// aws-xray-sdk-core-based traced()/captureAwsClient(). Callers must NOT also set
// `tracing: lambda.Tracing.ACTIVE` - confirmed live that running classic X-Ray's daemon tracing
// alongside this layer produces duplicated, fragmented traces (two independent
// async-context-tracking systems instrumenting the same invocation). First proven on imposter's
// Lambda (games-stack.ts) before being extracted here for reuse across every other project.
export function applyApplicationSignals(fn: lambda.Function): void {
  fn.addLayers(
    lambda.LayerVersion.fromLayerVersionArn(fn, "AppSignalsLayer", APPLICATION_SIGNALS_NODEJS_LAYER_ARN)
  );
  fn.addEnvironment("AWS_LAMBDA_EXEC_WRAPPER", "/opt/otel-instrument");
  // "http" only covers Node's legacy http/https module; "undici" is required for native fetch
  // (the transport @anthropic-ai/sdk actually uses) - without it, Anthropic calls get silently
  // zero tracing coverage. The layer's own otel-instrument script appends "aws-lambda,http" to
  // whatever list is set here.
  fn.addEnvironment("OTEL_NODE_ENABLED_INSTRUMENTATIONS", "aws-sdk,undici");
  fn.role?.addManagedPolicy(
    iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchLambdaApplicationSignalsExecutionRolePolicy")
  );
}
