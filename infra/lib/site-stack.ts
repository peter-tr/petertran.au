import { Stack, StackProps, CfnOutput, Duration, RemovalPolicy, TimeZone } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as ses from "aws-cdk-lib/aws-ses";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as rum from "aws-cdk-lib/aws-rum";
import { Schedule, ScheduleExpression } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import * as path from "path";
import { FUNCTION_NAMES, LIVE_ALIAS_NAME } from "./shared/function-names";
import { applyApplicationSignals } from "./shared/application-signals";

export interface SiteStackProps extends StackProps {
  domainName: string;
  alternateDomainNames?: string[];
  certificate: acm.ICertificate;
  hostedZoneId: string;
  hostedZoneName: string;
  // Everything below is optional and defaults to prod's current values -
  // only the on-demand test environment (see infra/bin/app.ts) passes any
  // of these, so the prod SiteStack instantiation is unaffected by their
  // existence.
  tableName?: string;
  bucketName?: string;
  functionName?: string;
  // True only for the disposable test-env instantiation. Toggles off
  // everything that's either a domain-wide singleton (SES domain identity,
  // DMARC) that prod's invocation already owns, or genuine monitoring
  // infrastructure (RUM, its Cognito guest pool) that a throwaway
  // environment doesn't need - and toggles on managing this stack's own
  // Route 53 alias records, since (unlike prod's www/apex, migrated in
  // manually before this stack existed) the test domain has no DNS at all
  // until this stack creates it.
  isTestEnv?: boolean;
}

// Route 53 record names are relative to the zone (e.g. "test", "www.test"),
// not the full domain - derives one from the other so callers only ever
// have to think in full domain names.
function recordNameFor(domain: string, hostedZoneName: string): string {
  return domain === hostedZoneName ? "" : domain.slice(0, -(hostedZoneName.length + 1));
}

export class SiteStack extends Stack {
  // Exposed so ApiGatewayStack/ProvisionedConcurrencyStack can target it
  // without this stack needing to know anything about either.
  public readonly apiFn: lambda.Function;

  constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, props);

    // --- Data layer: resume content ---
    const table = new dynamodb.Table(this, "ResumeTable", {
      // Explicit, so it reads clearly in the X-Ray trace map instead of
      // CloudFormation's auto-generated "PetertranSiteStack-ResumeTable...-..." name.
      tableName: props.tableName ?? "resume",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
      // Both protections are pointless (and just cost/complication) on the
      // test env's disposable copy, which `cdk destroy` needs to actually
      // tear down - see destroy-test-env.yml.
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: !props.isTestEnv },
      deletionProtection: !props.isTestEnv,
    });

    const anthropicSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AnthropicApiKey",
      "petertran-au/anthropic-api-key"
    );
    // Read-only cost/usage reporting credential, separate from the messages
    // API key above -- kept as its own secret rather than a Lambda env var
    // for consistency with how the other Anthropic key is stored.
    const anthropicAdminSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AnthropicAdminApiKey",
      "petertran-au/anthropic-admin-key"
    );

    // --- Contact form email notifications ---
    const hostedZone = route53.PublicHostedZone.fromPublicHostedZoneAttributes(this, "PetertranHostedZone", {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.hostedZoneName,
    });

    // The SES domain identity (DKIM/mailFrom) and its DMARC record are
    // account-wide singletons keyed on the bare domain, not per-environment -
    // prod's invocation of this stack owns them. The test-env invocation
    // just imports the same already-verified identity (same pattern
    // pantry-stack.ts's digest Lambda already uses) so its contact-form
    // mutation doesn't hard-fail; it must not try to create a second one.
    let emailIdentity: ses.IEmailIdentity;
    if (props.isTestEnv) {
      emailIdentity = ses.EmailIdentity.fromEmailIdentityName(
        this,
        "SesDomainIdentity",
        props.hostedZoneName
      );
    } else {
      // Verifies the whole domain via DNS (auto-adds DKIM/MAIL FROM records
      // to the existing Route 53 zone) so the Lambda can send FROM an
      // @petertran.au address. Still in the SES sandbox, but that's fine
      // here: the only recipient is Peter's own inbox, which he verifies
      // separately.
      emailIdentity = new ses.EmailIdentity(this, "SesDomainIdentity", {
        identity: ses.Identity.publicHostedZone(hostedZone),
        // Without this, the envelope-from (Return-Path) defaults to
        // amazonses.com, which fails SPF alignment for petertran.au -- strict
        // filters (Outlook in particular) are much more likely to junk mail
        // from a brand-new domain that doesn't align. This adds the required
        // MX + SPF TXT records to the same Route 53 zone automatically.
        mailFromDomain: "mail.petertran.au",
      });
      // No DMARC record at all reads as a red flag to strict filters (Outlook
      // especially) even when DKIM/SPF both pass -- p=none is monitor-only, so
      // it can't cause legitimate mail to be rejected while still signaling
      // "this domain has a real DMARC policy."
      new route53.TxtRecord(this, "DmarcRecord", {
        zone: hostedZone,
        recordName: "_dmarc",
        values: ["v=DMARC1; p=none; rua=mailto:peter2002tran@outlook.com"],
      });
    }

    // While the account is in the SES sandbox, IAM enforces ses:SendEmail on
    // the RECIPIENT identity too, not just the sender's -- this one was
    // created out-of-band via the CLI (it's Peter's own inbox, verified by
    // him clicking the link SES emailed him), so it's imported here rather
    // than owned by this stack.
    const recipientIdentity = ses.EmailIdentity.fromEmailIdentityName(
      this,
      "SesRecipientIdentity",
      "peter2002tran@outlook.com"
    );

    // --- GraphQL API (Lambda, fronted by the shared ApiGatewayStack) ---
    const apiFn = new lambda.Function(this, "GraphQLFunction", {
      // Explicit, so it reads clearly in the X-Ray trace map instead of
      // CloudFormation's auto-generated "PetertranSiteStack-GraphQLFunction72B66DDD-..." name.
      // Also lets ApiGatewayStack/ProvisionedConcurrencyStack reference it by
      // a plain string instead of a live construct reference, which would
      // create a CloudFormation cross-stack export - an export blocks this
      // function from ever being replaced while that stack still has it
      // imported.
      functionName: props.functionName ?? FUNCTION_NAMES.portfolio,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/src/portfolio/dist")),
      // 1024, up from 256 (2026-07-24) - a cold trace outside the
      // ProvisionedConcurrencyStack warm window (8am-7pm Sydney) showed the
      // supergraph gateway's fan-out fetch to this Lambda dominated by an
      // ~3.8s gap between API Gateway's invoke and this function's own
      // traced segment starting - Lambda's Init phase (module load + Apollo
      // Server schema build), which happens before X-Ray/OTel can attach so
      // it's invisible on the trace waterfall. That phase's CPU scales with
      // memory the same as everything else, so more memory directly cuts
      // cold-start latency outside the PC window - not a peak-RSS headroom
      // question the way the old 256 comment was.
      memorySize: 1024,
      // 30s (not the default 15s): a backstop, not the primary safeguard,
      // for the all-time cost fields' worst case - CostRefreshFunction below
      // now refreshes both caches daily, so a real request only pays for
      // Anthropic's cost report (paginated, 31 days/page, a dozen-odd
      // sequential requests for a 12-month lookback) if that schedule ever
      // misses a day. One real request got stuck for ~17s paying that cost
      // before the daily refresh existed.
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
        ANTHROPIC_SECRET_ARN: anthropicSecret.secretArn,
        ANTHROPIC_ADMIN_SECRET_ARN: anthropicAdminSecret.secretArn,
        CONTACT_FROM_EMAIL: "contact@petertran.au",
        CONTACT_TO_EMAIL: "peter2002tran@outlook.com",
      },
      // No lambda.Tracing.ACTIVE here - see applyApplicationSignals()'s doc
      // comment for why.
    });
    table.grantReadWriteData(apiFn);
    anthropicSecret.grantRead(apiFn);
    anthropicAdminSecret.grantRead(apiFn);
    emailIdentity.grantSendEmail(apiFn);
    recipientIdentity.grantSendEmail(apiFn);
    applyApplicationSignals(apiFn);

    // Qualifier ApiGatewayStack targets and ProvisionedConcurrencyStack
    // applies PC to - see LIVE_ALIAS_NAME's doc comment.
    new lambda.Alias(this, "LiveAlias", {
      aliasName: LIVE_ALIAS_NAME,
      version: apiFn.currentVersion,
    });
    // CloudWatch metrics (for the systemStats query), X-Ray traces (for
    // traceBreakdown), and Cost Explorer (for awsCostUsd) have no
    // resource-level scoping -- "*" is required here regardless of which
    // function is asking. applyApplicationSignals() above grants write
    // access (via the CloudWatchLambdaApplicationSignalsExecutionRolePolicy
    // managed policy); this adds the read APIs needed to query a trace back
    // out for the traceBreakdown dashboard feature.
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cloudwatch:GetMetricData",
          "xray:GetTraceSummaries",
          "xray:BatchGetTraces",
          "ce:GetCostAndUsage",
        ],
        resources: ["*"],
      })
    );

    this.apiFn = apiFn;

    // --- Daily proactive refresh of the footer's all-time cost figures ---
    // Not part of what the test env exists to validate (same reasoning as
    // RUM below) - a disposable environment doesn't need its own cost
    // figures kept warm.
    if (!props.isTestEnv) {
      const costRefreshFn = new lambda.Function(this, "PortfolioCostRefreshFunction", {
        functionName: "portfolio-cost-refresh",
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "cost-refresh-handler.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../../api/src/portfolio/dist")),
        memorySize: 256,
        // Generous - no request is waiting on this, and Anthropic's cost
        // report can take a dozen-odd sequential paginated requests (each
        // with its own 8s timeout) in the worst case.
        timeout: Duration.minutes(2),
        environment: {
          TABLE_NAME: table.tableName,
          ANTHROPIC_ADMIN_SECRET_ARN: anthropicAdminSecret.secretArn,
        },
      });
      table.grantReadWriteData(costRefreshFn);
      anthropicAdminSecret.grantRead(costRefreshFn);
      costRefreshFn.addToRolePolicy(
        new iam.PolicyStatement({ actions: ["ce:GetCostAndUsage"], resources: ["*"] })
      );
      applyApplicationSignals(costRefreshFn);

      // Early morning Sydney, well outside business hours - if this ever
      // runs long, it shouldn't contend with real traffic for anything.
      new Schedule(this, "PortfolioCostRefreshSchedule", {
        schedule: ScheduleExpression.cron({ minute: "0", hour: "4", timeZone: TimeZone.AUSTRALIA_SYDNEY }),
        target: new LambdaInvoke(costRefreshFn),
        description: "Daily proactive refresh of the footer's AWS/Anthropic all-time cost figures",
      });
    }

    // --- Static site: S3 (private, OAC) + CloudFront ---
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      // Explicit, so it reads clearly in the S3 console instead of
      // CloudFormation's auto-generated name. Account-suffixed since bucket
      // names are globally unique across all of AWS, not just this account -
      // same reasoning as the Cognito domainPrefix in zero-trust-lab-stack.ts.
      // Safe to replace despite autoDeleteObjects/DESTROY below: deploy.sh
      // re-syncs web/dist into the (new) bucket right after `cdk deploy`
      // finishes, so nothing is lost for longer than that one deploy.
      bucketName: props.bucketName ?? `petertran-au-site-${this.account}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    const distribution = new cloudfront.Distribution(this, "SiteDistribution", {
      defaultRootObject: "index.html",
      domainNames: [props.domainName, ...(props.alternateDomainNames ?? [])],
      certificate: props.certificate,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      // Not /index.html: prerender.tsx bakes "/"'s own rendered content
      // into that file, so serving it as the catch-all for every other
      // client-routed path (/notes, /pantry, /imposter, /settings, ...)
      // would show the home page's bio/title before client JS replaces it.
      // /fallback.html is the pristine, generic shell prerender.tsx writes
      // out before it makes any route-specific edits.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/fallback.html",
          ttl: Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/fallback.html",
          ttl: Duration.seconds(0),
        },
      ],
    });

    // Prod's www/apex records were migrated in manually before this stack
    // existed (see infra/bin/app.ts's comment on the hosted zone) and stay
    // that way - CloudFormation would collide with them if this tried to
    // create matching records. The test domain has no such history, so its
    // invocation of this stack has to actually own its DNS.
    if (props.isTestEnv) {
      const siteAliasTarget = route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution)
      );
      for (const domain of [props.domainName, ...(props.alternateDomainNames ?? [])]) {
        const recordName = recordNameFor(domain, props.hostedZoneName);
        new route53.ARecord(this, `SiteAliasRecordV4-${domain}`, {
          zone: hostedZone,
          recordName,
          target: siteAliasTarget,
        });
        new route53.AaaaRecord(this, `SiteAliasRecordV6-${domain}`, {
          zone: hostedZone,
          recordName,
          target: siteAliasTarget,
        });
      }
    }

    new CfnOutput(this, "CloudFrontDomainName", { value: distribution.distributionDomainName });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new CfnOutput(this, "BucketName", { value: siteBucket.bucketName });
    new CfnOutput(this, "TableName", { value: table.tableName });

    // --- CloudWatch RUM: pageviews, client-side errors, performance ---
    // Real monitoring infrastructure, not something the disposable test env
    // needs - and its resource names (AppMonitor, Cognito identity pool,
    // guest role) are explicit literals that would collide with prod's if
    // this stack were instantiated a second time.
    if (!props.isTestEnv) {
      // Guest (unauthenticated) Cognito identity pool is the auth path RUM's
      // web client uses to sign PutRumEvents from the browser - there's no
      // logged-in user on this site, so every visitor assumes the same
      // guest role, scoped to nothing but sending telemetry for this one
      // app monitor.
      const rumIdentityPool = new cognito.CfnIdentityPool(this, "RumIdentityPool", {
        // Explicit, so it reads clearly in the Cognito console instead of
        // CloudFormation's auto-generated name.
        identityPoolName: "petertran_au_rum",
        allowUnauthenticatedIdentities: true,
      });

      // Name (not the generated AppMonitor id) is what the ARN is keyed on,
      // so it can be computed here and handed to the guest role's policy
      // before the app monitor resource below exists - avoids a circular
      // dependency between the two.
      const rumAppMonitorName = "petertran-au";
      const rumAppMonitorArn = `arn:aws:rum:${this.region}:${this.account}:appmonitor/${rumAppMonitorName}`;

      const rumGuestRole = new iam.Role(this, "RumGuestRole", {
        // Explicit, so it reads clearly in the IAM console instead of
        // CloudFormation's auto-generated name.
        roleName: "rum-guest-role",
        assumedBy: new iam.FederatedPrincipal(
          "cognito-identity.amazonaws.com",
          {
            StringEquals: { "cognito-identity.amazonaws.com:aud": rumIdentityPool.ref },
            "ForAnyValue:StringLike": { "cognito-identity.amazonaws.com:amr": "unauthenticated" },
          },
          "sts:AssumeRoleWithWebIdentity"
        ),
      });
      rumGuestRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ["rum:PutRumEvents"],
          resources: [rumAppMonitorArn],
        })
      );

      new cognito.CfnIdentityPoolRoleAttachment(this, "RumIdentityPoolRoleAttachment", {
        identityPoolId: rumIdentityPool.ref,
        roles: { unauthenticated: rumGuestRole.roleArn },
      });

      const rumAppMonitor = new rum.CfnAppMonitor(this, "RumAppMonitor", {
        name: rumAppMonitorName,
        domainList: [props.domainName, ...(props.alternateDomainNames ?? [])],
        // Telemetry data itself is 30-day-retained inside RUM regardless; this
        // also mirrors it to CloudWatch Logs so it can be queried with Logs
        // Insights (or graphed on a dashboard) past that window, same as the
        // X-Ray traces the GraphQL Lambda above already writes.
        cwLogEnabled: true,
        appMonitorConfiguration: {
          identityPoolId: rumIdentityPool.ref,
          guestRoleArn: rumGuestRole.roleArn,
          allowCookies: true,
          // Traffic here is low enough that 100% sampling costs nothing
          // meaningful and gives a complete picture rather than an
          // extrapolated one.
          sessionSampleRate: 1,
          telemetries: ["errors", "performance", "http"],
        },
      });

      new CfnOutput(this, "RumAppMonitorId", { value: rumAppMonitor.attrId });
      new CfnOutput(this, "RumIdentityPoolId", { value: rumIdentityPool.ref });
    }
  }
}
