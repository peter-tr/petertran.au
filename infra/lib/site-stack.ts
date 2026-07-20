import { Stack, StackProps, CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
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
import * as ses from "aws-cdk-lib/aws-ses";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as rum from "aws-cdk-lib/aws-rum";
import * as path from "path";
import { FUNCTION_NAMES } from "./shared/function-names";

export interface SiteStackProps extends StackProps {
  domainName: string;
  alternateDomainNames?: string[];
  certificate: acm.ICertificate;
  hostedZoneId: string;
  hostedZoneName: string;
}

export class SiteStack extends Stack {
  // Exposed so PetertranWarmupStack can schedule a keep-warm ping against it
  // without this stack needing to know anything about warmup at all.
  public readonly apiFn: lambda.Function;

  constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, props);

    // --- Data layer: resume content ---
    const table = new dynamodb.Table(this, "ResumeTable", {
      // Explicit, so it reads clearly in the X-Ray trace map instead of
      // CloudFormation's auto-generated "PetertranSiteStack-ResumeTable...-..." name.
      tableName: "resume",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
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
    // Verifies the whole domain via DNS (auto-adds DKIM/MAIL FROM records to
    // the existing Route 53 zone) so the Lambda can send FROM an
    // @petertran.au address. Still in the SES sandbox, but that's fine here:
    // the only recipient is Peter's own inbox, which he verifies separately.
    const hostedZone = route53.PublicHostedZone.fromPublicHostedZoneAttributes(this, "PetertranHostedZone", {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.hostedZoneName,
    });
    const emailIdentity = new ses.EmailIdentity(this, "SesDomainIdentity", {
      identity: ses.Identity.publicHostedZone(hostedZone),
      // Without this, the envelope-from (Return-Path) defaults to
      // amazonses.com, which fails SPF alignment for petertran.au -- strict
      // filters (Outlook in particular) are much more likely to junk mail
      // from a brand-new domain that doesn't align. This adds the required
      // MX + SPF TXT records to the same Route 53 zone automatically.
      mailFromDomain: "mail.petertran.au",
    });
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
    // No DMARC record at all reads as a red flag to strict filters (Outlook
    // especially) even when DKIM/SPF both pass -- p=none is monitor-only, so
    // it can't cause legitimate mail to be rejected while still signaling
    // "this domain has a real DMARC policy."
    new route53.TxtRecord(this, "DmarcRecord", {
      zone: hostedZone,
      recordName: "_dmarc",
      values: ["v=DMARC1; p=none; rua=mailto:peter2002tran@outlook.com"],
    });

    // --- GraphQL API (Lambda, fronted by the shared ApiGatewayStack) ---
    const apiFn = new lambda.Function(this, "GraphQLFunction", {
      // Explicit, so it reads clearly in the X-Ray trace map instead of
      // CloudFormation's auto-generated "PetertranSiteStack-GraphQLFunction72B66DDD-..." name.
      // Also lets WarmupStack reference it by a plain string instead of a
      // live construct reference, which would create a CloudFormation
      // cross-stack export - an export blocks this function from ever being
      // replaced while WarmupStack still has it imported.
      functionName: FUNCTION_NAMES.portfolio,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/src/portfolio/dist")),
      // 512, not the default 256 - same reasoning as pantry's GraphQLFunction:
      // this is a synchronous Lambda on a user-facing request path (behind
      // ApiGatewayStack), so cold-start CPU (which scales with memory) is
      // latency a real visitor waits on, not a background job nobody's
      // watching.
      memorySize: 512,
      // 30s (not the default 15s) to leave headroom for the all-time cost
      // fields on a cold cache: Anthropic's cost report caps at 31 days per
      // page, so a 12-month lookback can take a dozen-odd sequential requests.
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
        ANTHROPIC_SECRET_ARN: anthropicSecret.secretArn,
        ANTHROPIC_ADMIN_SECRET_ARN: anthropicAdminSecret.secretArn,
        CONTACT_FROM_EMAIL: "contact@petertran.au",
        CONTACT_TO_EMAIL: "peter2002tran@outlook.com",
      },
      // Traces every invocation to X-Ray -- lets the systemStats dashboard
      // show a real Lambda/DynamoDB/Anthropic timing breakdown per operation.
      tracing: lambda.Tracing.ACTIVE,
    });
    table.grantReadWriteData(apiFn);
    anthropicSecret.grantRead(apiFn);
    anthropicAdminSecret.grantRead(apiFn);
    emailIdentity.grantSendEmail(apiFn);
    recipientIdentity.grantSendEmail(apiFn);
    // CloudWatch metrics (for the systemStats query), X-Ray traces (for
    // traceBreakdown), and Cost Explorer (for awsCostUsd) have no
    // resource-level scoping -- "*" is required here regardless of which
    // function is asking. `Tracing.ACTIVE` above already grants write access
    // (PutTraceSegments); this adds the read APIs needed to query a trace
    // back out.
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

    // --- Static site: S3 (private, OAC) + CloudFront ---
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      // Explicit, so it reads clearly in the S3 console instead of
      // CloudFormation's auto-generated name. Account-suffixed since bucket
      // names are globally unique across all of AWS, not just this account -
      // same reasoning as the Cognito domainPrefix in zero-trust-lab-stack.ts.
      // Safe to replace despite autoDeleteObjects/DESTROY below: deploy.sh
      // re-syncs web/dist into the (new) bucket right after `cdk deploy`
      // finishes, so nothing is lost for longer than that one deploy.
      bucketName: `petertran-au-site-${this.account}`,
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
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.seconds(0),
        },
      ],
    });

    // --- CloudWatch RUM: pageviews, client-side errors, performance ---
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

    new CfnOutput(this, "CloudFrontDomainName", { value: distribution.distributionDomainName });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
    new CfnOutput(this, "BucketName", { value: siteBucket.bucketName });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "RumAppMonitorId", { value: rumAppMonitor.attrId });
    new CfnOutput(this, "RumIdentityPoolId", { value: rumIdentityPool.ref });
  }
}
