import { Stack, StackProps, CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as path from "path";
import { FUNCTION_NAMES } from "./shared/function-names";

export interface GamesStackProps extends StackProps {
  domainName: string;
  alternateDomainNames?: string[];
}

/**
 * Small side-project games and other misc one-offs that live alongside
 * petertran.au but are deliberately kept out of its resume API - their own
 * schema, their own Lambda, their own table, so they never show up in that
 * API's GraphiQL explorer or its schema-aware "Ask AI" query generator.
 */
export class GamesStack extends Stack {
  // Exposed so PetertranWarmupStack can schedule a keep-warm ping against it
  // without this stack needing to know anything about warmup at all.
  public readonly imposterFn: lambda.Function;

  constructor(scope: Construct, id: string, props: GamesStackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, "GamesTable", {
      // Explicit, so it reads clearly in the X-Ray trace map instead of
      // CloudFormation's auto-generated name.
      tableName: "games",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
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
      // CloudFormation's auto-generated name. Also lets WarmupStack
      // reference it by a plain string - see site-stack.ts's identical
      // comment on GraphQLFunction for why that matters.
      functionName: FUNCTION_NAMES.imposter,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/src/games/imposter/dist")),
      // 512, not the default 256 - same reasoning as pantry's/portfolio's
      // GraphQLFunction: this is a synchronous Function URL on a user-facing
      // request path, so cold-start CPU (which scales with memory) is
      // latency a real visitor waits on, not a background job.
      memorySize: 512,
      timeout: Duration.seconds(15),
      environment: {
        TABLE_NAME: table.tableName,
        ANTHROPIC_SECRET_ARN: anthropicSecret.secretArn,
      },
      tracing: lambda.Tracing.ACTIVE,
    });
    table.grantReadWriteData(imposterFn);
    anthropicSecret.grantRead(imposterFn);
    this.imposterFn = imposterFn;

    const imposterFnUrl = imposterFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: [
          `https://${props.domainName}`,
          ...(props.alternateDomainNames ?? []).map((d) => `https://${d}`),
          "http://localhost:5173",
          "http://localhost:3000",
        ],
        allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST],
        allowedHeaders: ["content-type", "apollo-require-preflight"],
        maxAge: Duration.hours(1),
      },
    });

    new CfnOutput(this, "ImposterGraphQLEndpoint", { value: imposterFnUrl.url });
  }
}
