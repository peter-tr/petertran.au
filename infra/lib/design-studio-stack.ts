import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "node:path";
import { FUNCTION_NAMES, LIVE_ALIAS_NAME } from "./shared/function-names";
import { applyApplicationSignals } from "./shared/application-signals";
import { bedrockInvokeResources } from "./shared/bedrock-models";

export interface DesignStudioStackProps extends StackProps {
  // Optional, defaults to prod's current value - only the on-demand test
  // environment would pass this, matching every other project's stack.
  functionName?: string;
  // True only for the on-demand test env - points the Lambda at a
  // "design-studio-test" database instead of "design-studio", isolating it
  // within the same Atlas cluster/secret rather than needing a second
  // manually-provisioned cluster. See lib/db/client.ts's MONGO_DB_NAME.
  isTestEnv?: boolean;
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
    //
    // Passed to the Lambda below as a plain MONGO_URI env var (via
    // `.secretValue`, a CloudFormation dynamic reference resolved at deploy
    // time) rather than as MONGO_SECRET_ARN fetched at runtime - every cold
    // start was previously paying a GetSecretValue round-trip before it
    // could even attempt the Mongo connection. Trade-off: the plaintext URI
    // now sits in this Lambda's environment config (readable by anyone with
    // lambda:GetFunctionConfiguration, a broader surface than the scoped
    // secretsmanager:GetSecretValue grant this replaced) and only refreshes
    // on redeploy, not on secret rotation. Acceptable here - single-user
    // account, Atlas credentials aren't rotated out-of-band.
    const mongoSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "MongoConnectionString",
      "petertran-au/design-studio-mongo-uri"
    );
    // Same secret every other Anthropic-calling Lambda in this repo already
    // reads (see pantry-stack.ts's anthropicSecret) - reused here for the
    // AI design-generation mutation, not a project-specific key. Resolved
    // into a plain ANTHROPIC_API_KEY env var at deploy time below, same as
    // mongoSecret above and for the same reason (see its comment).
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
      // 512, down from 1024 (2026-07-25) - same reasoning as the portfolio
      // GraphQL Lambda's identical comment (site-stack.ts): the 1024 bump's
      // premise (more memory directly cuts cold-start latency) didn't hold
      // up under isolation testing, and halving memory + doubling PC count
      // is cost-neutral while fixing PC's actual capacity shortfall.
      memorySize: 512,
      // 30s, up from 20s (2026-07-25) - generateDesignElements on the
      // SONNET tier runs adaptive thinking (see generate-elements.ts),
      // which measured 10-11s end-to-end even at the lowest effort level;
      // 20s left too little margin over that plus cold-start MongoDB setup.
      timeout: Duration.seconds(30),
      environment: {
        MONGO_URI: mongoSecret.secretValue.unsafeUnwrap(),
        MONGO_DB_NAME: props.isTestEnv ? "design-studio-test" : "design-studio",
        ANTHROPIC_API_KEY: anthropicSecret.secretValue.unsafeUnwrap(),
      },
      // No lambda.Tracing.ACTIVE here - see applyApplicationSignals()'s doc
      // comment for why.
    });

    // Lets AiSettings.provider === "BEDROCK" actually invoke Claude via
    // Bedrock (see api-shared/anthropic-bedrock-client.ts) - scoped to just
    // the au. cross-region inference profiles this feature uses, plus the
    // underlying per-region foundation models each profile can route to
    // (Bedrock authorizes against both the profile ARN and whichever
    // regional model ARN it ends up dispatching to).
    designStudioFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: bedrockInvokeResources(this.region, this.account),
      })
    );

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
