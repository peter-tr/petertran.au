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
      // Explicit, so it reads clearly in the X-Ray trace map instead of
      // CloudFormation's auto-generated name.
      functionName: "pantry-graphql",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "pantry/handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/dist")),
      // 512, not the other Lambdas' 256 - this is the one on the user-facing
      // request path (Function URL), and Lambda cold-start CPU scales with
      // memory: the bundle pulls in @apollo/server + AWS SDK v3 +
      // @anthropic-ai/sdk (parse-command/check-prices import it eagerly even
      // though the client itself inits lazily), so init time was a real
      // contributor to the ~2-3s first-load-of-the-day latency.
      memorySize: 512,
      // Generous - "recipes" mode (esp. an open "what can I make?" request
      // returning several full recipes) has been observed taking 6-8s warm,
      // and a cold start (Secrets Manager fetch + Anthropic client init) on
      // top of that was enough to blow through the previous 15s timeout.
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
        ANTHROPIC_SECRET_ARN: anthropicSecret.secretArn,
      },
      // Traces every invocation to X-Ray, same as the portfolio GraphQL
      // Lambda - without this the Function URL never gets a trace since
      // there's no upstream (API Gateway etc.) to originate one.
      tracing: lambda.Tracing.ACTIVE,
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
      functionName: "pantry-digest",
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
      tracing: lambda.Tracing.ACTIVE,
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

    // --- Daily price check for InventoryItem.trackPrice items ---
    // Unlike the digest Lambda, this one writes back to the table
    // (lastKnownPrice), so it needs read+write, and it calls Anthropic's
    // web_search/web_fetch tools, so it needs the same secret as the main
    // API Lambda.
    const priceCheckFn = new lambda.Function(this, "PantryPriceCheckFunction", {
      functionName: "pantry-price-check",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "pantry/price-check-handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/dist")),
      memorySize: 256,
      // Generous per-item ceiling (web_search + web_fetch round trips), but
      // each individual Anthropic call is itself capped at 30s client-side
      // (see check-prices.ts) - this is a backstop for the whole batch, not
      // the primary safeguard against a single call running away.
      timeout: Duration.minutes(10),
      environment: {
        TABLE_NAME: table.tableName,
        ANTHROPIC_SECRET_ARN: anthropicSecret.secretArn,
      },
      tracing: lambda.Tracing.ACTIVE,
    });
    table.grantReadWriteData(priceCheckFn);
    anthropicSecret.grantRead(priceCheckFn);

    // No automatic schedule - lets the main GraphQL Lambda's syncPricesNow
    // mutation fire-and-forget invoke this one, purely on demand from the
    // Settings page's "Sync prices now" button. Previously ran on a daily
    // schedule too, but real Anthropic spend from unattended runs (this
    // job's own, plus the auto-trigger that used to fire whenever
    // trackPrice was toggled on) turned out to be a meaningful chunk of a
    // real credit-exhaustion incident - manual-only removes both.
    apiFn.addEnvironment("PRICE_CHECK_FUNCTION_NAME", priceCheckFn.functionName);
    priceCheckFn.grantInvoke(apiFn);
  }
}
