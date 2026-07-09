import { Stack, StackProps, CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as path from "path";

export interface PantryStackProps extends StackProps {
  domainName: string;
  alternateDomainNames?: string[];
}

/**
 * Fully separate service from SiteStack: own table, own Lambda, own
 * Function URL, own schema. Nothing here is shared with the resume API -
 * that's deliberate, so each can evolve (and be reasoned about) independently.
 */
export class PantryStack extends Stack {
  constructor(scope: Construct, id: string, props: PantryStackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, "PantryTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });

    const apiFn = new lambda.Function(this, "PantryGraphQLFunction", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../pantry-api/dist")),
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });
    table.grantReadWriteData(apiFn);

    const fnUrl = apiFn.addFunctionUrl({
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

    new CfnOutput(this, "PantryGraphQLEndpoint", { value: fnUrl.url });
    new CfnOutput(this, "PantryTableName", { value: table.tableName });
  }
}
