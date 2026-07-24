import { Stack, StackProps, Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as path from "path";
import { FUNCTION_NAMES, LIVE_ALIAS_NAME } from "./shared/function-names";
import { applyApplicationSignals } from "./shared/application-signals";

export interface GamesStackProps extends StackProps {
  // Optional, defaults to prod's current values - only the on-demand test
  // environment (see infra/bin/app.ts) passes any of these.
  tableName?: string;
  functionName?: string;
  // True only for the disposable test-env instantiation - drops the
  // table's deletion protection/PITR so `cdk destroy` can actually tear it
  // down (see destroy-test-env.yml).
  isTestEnv?: boolean;
}

/**
 * Small side-project games and other misc one-offs that live alongside
 * petertran.au but are deliberately kept out of its resume API - their own
 * schema, their own Lambda, their own table, so they never show up in that
 * API's GraphiQL explorer or its schema-aware "Ask AI" query generator.
 */
export class GamesStack extends Stack {
  // Exposed so ApiGatewayStack/ProvisionedConcurrencyStack can target it
  // without this stack needing to know anything about either.
  public readonly imposterFn: lambda.Function;

  constructor(scope: Construct, id: string, props: GamesStackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, "GamesTable", {
      // Explicit, so it reads clearly in the X-Ray trace map instead of
      // CloudFormation's auto-generated name.
      tableName: props.tableName ?? "games",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: !props.isTestEnv },
      deletionProtection: !props.isTestEnv,
    });

    // Sparse index for "list live games" - only games still in REVEAL or
    // DISCUSSION carry gsi1pk/gsi1sk (see store.ts), so this stays small and
    // self-cleaning instead of growing with the full games-kept-forever table.
    table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
    });

    // Reuses the same Anthropic key as the resume API's "Surprise Me" word
    // pairs - it's the same underlying account/budget either way.
    const anthropicSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AnthropicApiKey",
      "petertran-au/anthropic-api-key"
    );

    const imposterFn = new lambda.Function(this, "ImposterFunction", {
      // Explicit, so it reads clearly in the X-Ray trace map instead of
      // CloudFormation's auto-generated name. Also lets ApiGatewayStack/
      // ProvisionedConcurrencyStack reference it by a plain string - see
      // site-stack.ts's identical comment on GraphQLFunction for why that
      // matters.
      functionName: props.functionName ?? FUNCTION_NAMES.imposter,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/src/games/imposter/dist")),
      // 1024, up from 256 (2026-07-24) - same reasoning as the portfolio
      // GraphQL Lambda's identical comment (site-stack.ts): a cold trace
      // outside the ProvisionedConcurrencyStack warm window showed Lambda
      // Init (module load + Apollo Server schema build, invisible on the
      // X-Ray waterfall since it runs before the tracer attaches) was the
      // dominant cost, and that phase's CPU scales with memory.
      memorySize: 1024,
      timeout: Duration.seconds(15),
      environment: {
        TABLE_NAME: table.tableName,
        ANTHROPIC_SECRET_ARN: anthropicSecret.secretArn,
      },
      // No lambda.Tracing.ACTIVE here - see applyApplicationSignals()'s doc
      // comment for why.
    });
    table.grantReadWriteData(imposterFn);
    anthropicSecret.grantRead(imposterFn);
    applyApplicationSignals(imposterFn);
    this.imposterFn = imposterFn;

    // Qualifier ApiGatewayStack targets and ProvisionedConcurrencyStack
    // applies PC to - see LIVE_ALIAS_NAME's doc comment.
    new lambda.Alias(this, "LiveAlias", {
      aliasName: LIVE_ALIAS_NAME,
      version: imposterFn.currentVersion,
    });
  }
}
