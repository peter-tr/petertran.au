import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as path from "path";
import { FUNCTION_NAMES, LIVE_ALIAS_NAME } from "./shared/function-names";
import { applyApplicationSignals } from "./shared/application-signals";

export interface DesignStudioStackProps extends StackProps {
  // Optional, defaults to prod's current value - only the on-demand test
  // environment would pass this, matching every other project's stack.
  functionName?: string;
}

/**
 * Design Studio - a mock Canva-style design editor. Deliberately the only
 * project in this repo with no DynamoDB table: designs are large, deeply
 * nested documents that gain new element types/properties as the editor
 * grows, so this uses MongoDB Atlas (provisioned separately, outside CDK -
 * see the Secrets Manager secret below) instead. No VPC either, matching
 * every other Lambda here - Atlas's Network Access list has to allow
 * 0.0.0.0/0 as a result, secured by the credentials in the connection
 * string plus TLS (which Atlas requires by default).
 */
export class DesignStudioStack extends Stack {
  // Exposed so ApiGatewayStack/ProvisionedConcurrencyStack can target it
  // without this stack needing to know anything about either.
  public readonly designStudioFn: lambda.Function;

  constructor(scope: Construct, id: string, props: DesignStudioStackProps = {}) {
    super(scope, id, props);

    // Created manually in Secrets Manager ahead of first deploy (Atlas
    // itself isn't a CDK-managed resource) - `fromSecretNameV2` just
    // imports the existing secret by name, same pattern as pantry-stack.ts's
    // anthropicSecret.
    const mongoSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "MongoConnectionString",
      "petertran-au/design-studio-mongo-uri"
    );
    // Same secret every other Anthropic-calling Lambda in this repo already
    // reads (see pantry-stack.ts's anthropicSecret) - reused here for the
    // AI design-generation mutation, not a project-specific key.
    const anthropicSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AnthropicApiKey",
      "petertran-au/anthropic-api-key"
    );

    const designStudioFn = new lambda.Function(this, "DesignStudioFunction", {
      // Explicit, so it reads clearly in the X-Ray trace map instead of
      // CloudFormation's auto-generated name - same reasoning as every
      // other project's Lambda in this repo.
      functionName: props.functionName ?? FUNCTION_NAMES.designStudio,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/src/design-studio/dist")),
      memorySize: 256,
      // Generous relative to the DynamoDB-backed projects' 15-30s - a cold
      // start here also pays for establishing a fresh MongoDB connection
      // (TLS handshake + auth) on top of the Secrets Manager fetch.
      timeout: Duration.seconds(20),
      environment: {
        MONGO_SECRET_ARN: mongoSecret.secretArn,
        ANTHROPIC_SECRET_ARN: anthropicSecret.secretArn,
      },
      // No lambda.Tracing.ACTIVE here - see applyApplicationSignals()'s doc
      // comment for why.
    });
    mongoSecret.grantRead(designStudioFn);
    anthropicSecret.grantRead(designStudioFn);
    applyApplicationSignals(designStudioFn);
    this.designStudioFn = designStudioFn;

    // Qualifier ApiGatewayStack targets and ProvisionedConcurrencyStack
    // applies PC to.
    new lambda.Alias(this, "LiveAlias", {
      aliasName: LIVE_ALIAS_NAME,
      version: designStudioFn.currentVersion,
    });
  }
}
