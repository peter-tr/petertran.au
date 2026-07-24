import { Stack, StackProps, CfnOutput, Duration, RemovalPolicy, TimeZone } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ses from "aws-cdk-lib/aws-ses";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Schedule, ScheduleExpression } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import * as path from "path";
import { FUNCTION_NAMES, LIVE_ALIAS_NAME } from "./shared/function-names";
import { applyApplicationSignals } from "./shared/application-signals";

export interface PantryStackProps extends StackProps {
  // Optional, defaults to prod's current values - only the on-demand test
  // environment (see infra/bin/app.ts) passes any of these.
  tableName?: string;
  functionName?: string;
  // True only for the disposable test-env instantiation. Skips the digest
  // email schedule and the price-check Lambda entirely (neither is part of
  // what the test env exists to validate - see this stack's own doc
  // comment - and an unattended digest/price-check job is exactly the kind
  // of background Anthropic spend the manual-only price-check change below
  // was meant to avoid), and drops the table's deletion protection/PITR so
  // `cdk destroy` can actually tear it down.
  isTestEnv?: boolean;
}

/**
 * Fully separate service from SiteStack: own table, own Lambda, own
 * schema - deliberately, so it can evolve (and be reasoned about)
 * independently of the resume API. Source lives at api/src/pantry/,
 * alongside the resume API and games in the same npm workspace - deployment
 * separation doesn't require a separate workspace, same as GamesStack.
 */
export class PantryStack extends Stack {
  // Exposed so ApiGatewayStack/ProvisionedConcurrencyStack can target it
  // without this stack needing to know anything about either.
  public readonly apiFn: lambda.Function;

  constructor(scope: Construct, id: string, props: PantryStackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, "PantryTable", {
      // Explicit, so it reads clearly in the X-Ray trace map instead of
      // CloudFormation's auto-generated name.
      tableName: props.tableName ?? "pantry",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: !props.isTestEnv },
      deletionProtection: !props.isTestEnv,
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

    // Own pool, deliberately not reusing zero-trust-lab's - that one is a
    // fully-isolated learning-exercise IdP with its own quirks (opaque
    // token, KMS-signed short-lived JWT, plain-username sign-in). This is a
    // normal real-user pool: self-signup, email sign-in, Cognito's own
    // Hosted UI for the actual login page rather than a hand-rolled form -
    // real password storage/verification/reset for free.
    const userPool = new cognito.UserPool(this, "PantryUserPool", {
      userPoolName: "pantry-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      removalPolicy: props.isTestEnv ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    });

    const userPoolDomain = userPool.addDomain("PantryUserPoolDomain", {
      cognitoDomain: { domainPrefix: `petertran-pantry-${this.account}` },
    });

    // Public SPA client (no secret - PKCE covers the authorization-code
    // exchange instead) - the web app calls Cognito's Hosted UI/token
    // endpoints directly, there's no server-side OAuth participant of its
    // own the way zero-trust-lab's idp-bridge is. Callback/logout URLs
    // mirror api-shared http.ts's corsHeaders ALLOWED_ORIGINS list (prod,
    // the on-demand test env, and local dev) plus the /pantry route itself.
    const pantryUrls = [
      "https://www.petertran.au/pantry",
      "https://petertran.au/pantry",
      "https://test.petertran.au/pantry",
      "https://www.test.petertran.au/pantry",
      "http://localhost:5173/pantry",
      "http://localhost:3000/pantry",
    ];
    const userPoolClient = userPool.addClient("PantryUserPoolClient", {
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: pantryUrls,
        logoutUrls: pantryUrls,
      },
    });

    new CfnOutput(this, "PantryCognitoDomain", {
      value: `https://${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
    });
    new CfnOutput(this, "PantryCognitoClientId", { value: userPoolClient.userPoolClientId });

    const apiFn = new lambda.Function(this, "PantryGraphQLFunction", {
      // Explicit, so it reads clearly in the X-Ray trace map instead of
      // CloudFormation's auto-generated name. Also lets ApiGatewayStack/
      // ProvisionedConcurrencyStack reference it by a plain string - see
      // site-stack.ts's identical comment on GraphQLFunction for why that
      // matters.
      functionName: props.functionName ?? FUNCTION_NAMES.pantry,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/src/pantry/dist")),
      // 256, not 512 - measured peak memory used has been a stable 175MB
      // across a full week/400+ invocations (never a rare spike a shorter
      // window would've missed), so 256 still leaves ~46% headroom.
      // Cold-start CPU (which scales with memory) no longer has to carry
      // the whole latency story on its own now that ProvisionedConcurrencyStack
      // keeps the `live` alias warm 8am-7pm Sydney for real visitors - see
      // that stack's doc comment.
      memorySize: 256,
      // Generous - "recipes" mode (esp. an open "what can I make?" request
      // returning several full recipes) has been observed taking 6-8s warm,
      // and a cold start (Secrets Manager fetch + Anthropic client init) on
      // top of that was enough to blow through the previous 15s timeout.
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
        ANTHROPIC_SECRET_ARN: anthropicSecret.secretArn,
        PANTRY_COGNITO_USER_POOL_ID: userPool.userPoolId,
        PANTRY_COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      },
      // No lambda.Tracing.ACTIVE here - see applyApplicationSignals()'s doc
      // comment for why.
    });
    table.grantReadWriteData(apiFn);
    anthropicSecret.grantRead(apiFn);
    applyApplicationSignals(apiFn);
    this.apiFn = apiFn;

    // Qualifier ApiGatewayStack targets and ProvisionedConcurrencyStack
    // applies PC to - see LIVE_ALIAS_NAME's doc comment.
    new lambda.Alias(this, "LiveAlias", {
      aliasName: LIVE_ALIAS_NAME,
      version: apiFn.currentVersion,
    });

    new CfnOutput(this, "PantryTableName", { value: table.tableName });

    // Neither the digest email nor the price-check job is part of what the
    // test env exists to validate (see this stack's doc comment) - and an
    // unattended schedule firing in test would be exactly the kind of
    // background Anthropic spend the manual-only price-check change below
    // was meant to avoid.
    if (!props.isTestEnv) {
      // --- Daily urgent-items digest email, 4pm Australia/Sydney ---
      // Both SES identities already exist (created/verified by SiteStack -
      // see its comment on why the recipient is imported rather than owned by
      // that stack too) - SES identities are account-level resources, so
      // re-importing them by name here and granting to this Lambda's own role
      // works the same as if this stack had created them itself. The domain
      // identity is the bare root domain ("petertran.au", matching
      // SiteStack's hostedZoneName and the contact@petertran.au FROM address)
      // - deliberately not SiteStack's props.domainName, which is
      // "www.petertran.au" and would import a non-existent identity.
      const emailIdentity = ses.EmailIdentity.fromEmailIdentityName(
        this,
        "SesDomainIdentity",
        "petertran.au"
      );
      const recipientIdentity = ses.EmailIdentity.fromEmailIdentityName(
        this,
        "SesRecipientIdentity",
        "peter2002tran@outlook.com"
      );

      const digestFn = new lambda.Function(this, "PantryDigestFunction", {
        functionName: "pantry-digest",
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "digest-handler.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../../api/src/pantry/dist")),
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
      applyApplicationSignals(digestFn);

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
        handler: "price-check-handler.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../../api/src/pantry/dist")),
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
      });
      table.grantReadWriteData(priceCheckFn);
      anthropicSecret.grantRead(priceCheckFn);
      applyApplicationSignals(priceCheckFn);

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
}
