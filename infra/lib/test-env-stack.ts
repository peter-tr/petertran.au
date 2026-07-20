import { Stack, StackProps, CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ses from "aws-cdk-lib/aws-ses";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as path from "path";

export interface TestEnvStackProps extends StackProps {
  // The web distribution's cert - built cross-region by TestCertStack (must
  // live in us-east-1 for CloudFront, same constraint as CertStack/SiteStack).
  certificate: acm.ICertificate;
  hostedZoneId: string;
  hostedZoneName: string;
}

/**
 * On-demand, disposable copy of the 3 GraphQL Lambdas + tables + a hosted
 * copy of web/, for testing big changes (e.g. Apollo Router/Federation)
 * without ever touching prod. Only instantiated when DEPLOY_TEST_ENV=true
 * (see infra/bin/app.ts) - invisible to the normal `cdk deploy --all` prod
 * pipeline. Deliberately excludes SES/RUM/warmup/zero-trust-lab duplication -
 * those aren't part of what's being tested; the portfolio test Lambda does
 * reuse the *existing* SES identities (no new ones) purely so its contact
 * form mutation doesn't hard-fail in the test env, same reasoning
 * pantry-stack.ts's digest Lambda already uses for the same identities.
 */
export class TestEnvStack extends Stack {
  constructor(scope: Construct, id: string, props: TestEnvStackProps) {
    super(scope, id, props);

    const hostedZone = route53.PublicHostedZone.fromPublicHostedZoneAttributes(this, "PetertranHostedZone", {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.hostedZoneName,
    });

    // Same underlying Anthropic account/budget as prod already treats these -
    // no separate test secret needed.
    const anthropicSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AnthropicApiKey",
      "petertran-au/anthropic-api-key"
    );
    const anthropicAdminSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AnthropicAdminApiKey",
      "petertran-au/anthropic-admin-key"
    );
    const emailIdentity = ses.EmailIdentity.fromEmailIdentityName(this, "SesDomainIdentity", "petertran.au");
    const recipientIdentity = ses.EmailIdentity.fromEmailIdentityName(
      this,
      "SesRecipientIdentity",
      "peter2002tran@outlook.com"
    );

    // --- Tables (same schema as prod, disposable) ---
    const resumeTable = new dynamodb.Table(this, "TestResumeTable", {
      tableName: "resume-test",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });

    const pantryTable = new dynamodb.Table(this, "TestPantryTable", {
      tableName: "pantry-test",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });

    const gamesTable = new dynamodb.Table(this, "TestGamesTable", {
      tableName: "games-test",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });
    gamesTable.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
    });

    // --- Lambdas: same build artifacts as prod, function names suffixed so
    // they never collide with FUNCTION_NAMES' prod literals ---
    const portfolioFn = new lambda.Function(this, "TestPortfolioFunction", {
      functionName: "portfolio-graphql-test",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/src/portfolio/dist")),
      memorySize: 512,
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: resumeTable.tableName,
        ANTHROPIC_SECRET_ARN: anthropicSecret.secretArn,
        ANTHROPIC_ADMIN_SECRET_ARN: anthropicAdminSecret.secretArn,
        CONTACT_FROM_EMAIL: "contact@petertran.au",
        CONTACT_TO_EMAIL: "peter2002tran@outlook.com",
      },
      tracing: lambda.Tracing.ACTIVE,
    });
    resumeTable.grantReadWriteData(portfolioFn);
    anthropicSecret.grantRead(portfolioFn);
    anthropicAdminSecret.grantRead(portfolioFn);
    emailIdentity.grantSendEmail(portfolioFn);
    recipientIdentity.grantSendEmail(portfolioFn);

    const pantryFn = new lambda.Function(this, "TestPantryFunction", {
      functionName: "pantry-graphql-test",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/src/pantry/dist")),
      memorySize: 512,
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: pantryTable.tableName,
        ANTHROPIC_SECRET_ARN: anthropicSecret.secretArn,
      },
      tracing: lambda.Tracing.ACTIVE,
    });
    pantryTable.grantReadWriteData(pantryFn);
    anthropicSecret.grantRead(pantryFn);

    const imposterFn = new lambda.Function(this, "TestImposterFunction", {
      functionName: "imposter-graphql-test",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/src/games/imposter/dist")),
      memorySize: 512,
      timeout: Duration.seconds(15),
      environment: {
        TABLE_NAME: gamesTable.tableName,
        ANTHROPIC_SECRET_ARN: anthropicSecret.secretArn,
      },
      tracing: lambda.Tracing.ACTIVE,
    });
    gamesTable.grantReadWriteData(imposterFn);
    anthropicSecret.grantRead(imposterFn);

    // --- API: api.test.petertran.au (reads as "api, under test") ---
    const apiDomain = `api.test.${props.hostedZoneName}`;
    const apiCertificate = new acm.Certificate(this, "TestApiCertificate", {
      domainName: apiDomain,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });
    const apiDomainName = new apigwv2.DomainName(this, "TestApiDomainName", {
      domainName: apiDomain,
      certificate: apiCertificate,
    });
    const httpApi = new apigwv2.HttpApi(this, "TestApiGateway", {
      defaultDomainMapping: { domainName: apiDomainName },
      corsPreflight: {
        // Open - this is a throwaway test endpoint, not a security boundary.
        allowOrigins: ["*"],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST],
        allowHeaders: ["content-type", "apollo-require-preflight"],
        maxAge: Duration.hours(1),
      },
    });

    const routes: { id: string; path: string; fn: lambda.Function }[] = [
      { id: "Portfolio", path: "/portfolio", fn: portfolioFn },
      { id: "Pantry", path: "/pantry", fn: pantryFn },
      { id: "Imposter", path: "/imposter", fn: imposterFn },
    ];
    for (const route of routes) {
      httpApi.addRoutes({
        path: route.path,
        // GET/POST, not ANY - same reason as api-gateway-stack.ts: ANY would
        // route the browser's CORS preflight OPTIONS to the Lambda instead of
        // letting the HttpApi's own corsPreflight config auto-answer it.
        methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
        integration: new HttpLambdaIntegration(`${route.id}Integration`, route.fn),
      });
    }

    const apiAliasTarget = route53.RecordTarget.fromAlias(
      new route53Targets.ApiGatewayv2DomainProperties(
        apiDomainName.regionalDomainName,
        apiDomainName.regionalHostedZoneId
      )
    );
    new route53.ARecord(this, "TestApiAliasRecordV4", {
      zone: hostedZone,
      recordName: "api.test",
      target: apiAliasTarget,
    });
    new route53.AaaaRecord(this, "TestApiAliasRecordV6", {
      zone: hostedZone,
      recordName: "api.test",
      target: apiAliasTarget,
    });

    // --- Site: test.petertran.au (S3 private + OAC, fronted by CloudFront) ---
    const siteBucket = new s3.Bucket(this, "TestSiteBucket", {
      // Same base name as SiteStack's bucket ("petertran-au-site"), same
      // `-test` suffix convention as the tables/Lambdas above.
      bucketName: `petertran-au-site-test-${this.account}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    const siteDistribution = new cloudfront.Distribution(this, "TestSiteDistribution", {
      defaultRootObject: "index.html",
      domainNames: [`test.${props.hostedZoneName}`],
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

    const siteAliasTarget = route53.RecordTarget.fromAlias(
      new route53Targets.CloudFrontTarget(siteDistribution)
    );
    new route53.ARecord(this, "TestSiteAliasRecordV4", {
      zone: hostedZone,
      recordName: "test",
      target: siteAliasTarget,
    });
    new route53.AaaaRecord(this, "TestSiteAliasRecordV6", {
      zone: hostedZone,
      recordName: "test",
      target: siteAliasTarget,
    });

    new CfnOutput(this, "TestApiBaseUrl", { value: `https://${apiDomain}` });
    new CfnOutput(this, "TestSiteBaseUrl", { value: `https://test.${props.hostedZoneName}` });
    // Same output *keys* as SiteStack's ("BucketName"/"DistributionId", not
    // "TestSiteBucketName" etc.) - build-and-deploy.yml's sync-web step just
    // swaps which stack it queries by name, not the query key itself.
    new CfnOutput(this, "BucketName", { value: siteBucket.bucketName });
    new CfnOutput(this, "DistributionId", { value: siteDistribution.distributionId });
  }
}
