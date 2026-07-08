import { Stack, StackProps, CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as path from "path";

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
  constructor(scope: Construct, id: string, props: GamesStackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, "GamesTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });

    // Reuses the same Anthropic key as the resume API's "Surprise Me" word
    // pairs - it's the same underlying account/budget either way.
    const anthropicSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AnthropicApiKey",
      "petertran-au/anthropic-api-key"
    );

    const imposterFn = new lambda.Function(this, "ImposterFunction", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "games/imposter/handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/dist")),
      memorySize: 256,
      timeout: Duration.seconds(15),
      environment: {
        TABLE_NAME: table.tableName,
        ANTHROPIC_SECRET_ARN: anthropicSecret.secretArn,
      },
    });
    table.grantReadWriteData(imposterFn);
    anthropicSecret.grantRead(imposterFn);

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
