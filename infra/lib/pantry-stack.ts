import { Stack, StackProps, CfnOutput, Duration, RemovalPolicy, TimeZone } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ses from "aws-cdk-lib/aws-ses";
import { Schedule, ScheduleExpression } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import * as path from "path";

export interface PantryStackProps extends StackProps {
  domainName: string;
  alternateDomainNames?: string[];
}

/**
 * Fully separate service from SiteStack: own table, own Lambda, own
 * Function URL, own schema - deliberately, so it can evolve (and be reasoned
 * about) independently of the resume API. Source lives at api/src/pantry/,
 * alongside the resume API and games in the same npm workspace - deployment
 * separation doesn't require a separate workspace, same as GamesStack.
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

    // Reuses the same Anthropic key as the resume API and Imposter - it's
    // the same underlying account/budget either way. Only parseCommand
    // (the AI command bar) calls it; every other pantry mutation is plain
    // DynamoDB CRUD.
    const anthropicSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AnthropicApiKey",
      "petertran-au/anthropic-api-key"
    );

    const apiFn = new lambda.Function(this, "PantryGraphQLFunction", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "pantry/handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/dist")),
      memorySize: 256,
      // Generous - "recipes" mode (esp. an open "what can I make?" request
      // returning several full recipes) has been observed taking 6-8s warm,
      // and a cold start (Secrets Manager fetch + Anthropic client init) on
      // top of that was enough to blow through the previous 15s timeout.
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
        ANTHROPIC_SECRET_ARN: anthropicSecret.secretArn,
      },
    });
    table.grantReadWriteData(apiFn);
    anthropicSecret.grantRead(apiFn);

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

    // --- Daily urgent-items digest email, 4pm Australia/Sydney ---
    // Both SES identities already exist (created/verified by SiteStack -
    // see its comment on why the recipient is imported rather than owned by
    // that stack too) - SES identities are account-level resources, so
    // re-importing them by name here and granting to this Lambda's own role
    // works the same as if this stack had created them itself. The domain
    // identity is the bare root domain ("petertran.au", matching
    // SiteStack's hostedZoneName and the contact@petertran.au FROM address)
    // - deliberately not props.domainName, which is "www.petertran.au" and
    // would import a non-existent identity.
    const emailIdentity = ses.EmailIdentity.fromEmailIdentityName(this, "SesDomainIdentity", "petertran.au");
    const recipientIdentity = ses.EmailIdentity.fromEmailIdentityName(
      this,
      "SesRecipientIdentity",
      "peter2002tran@outlook.com"
    );

    const digestFn = new lambda.Function(this, "PantryDigestFunction", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "pantry/digest-handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/dist")),
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
        CONTACT_FROM_EMAIL: "contact@petertran.au",
        CONTACT_TO_EMAIL: "peter2002tran@outlook.com",
      },
    });
    table.grantReadData(digestFn);
    emailIdentity.grantSendEmail(digestFn);
    recipientIdentity.grantSendEmail(digestFn);

    // Fires every hour on the hour, Sydney-local - the actual send time is
    // a user-configurable app setting (PantrySettings.digestHour), not
    // baked into infra, so it can be changed from the Pantry settings page
    // without a redeploy. The handler itself checks the current Sydney
    // hour against that setting and no-ops otherwise.
    new Schedule(this, "PantryDigestSchedule", {
      schedule: ScheduleExpression.cron({ minute: "0", hour: "*", timeZone: TimeZone.AUSTRALIA_SYDNEY }),
      target: new LambdaInvoke(digestFn),
      description: "Hourly check for the pantry urgent-shopping-list digest email (settings-gated)",
    });
  }
}
