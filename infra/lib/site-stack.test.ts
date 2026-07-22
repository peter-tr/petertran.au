import { describe, it, expect, vi, beforeAll, afterAll, type MockInstance } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { SiteStack } from "./site-stack";

function fakeCertificate(app: App) {
  // Real app.ts wires this cross-region from CertStack's output; a
  // directly-imported fake ARN avoids the crossRegionReferences plumbing
  // this smoke test doesn't need.
  const certScope = new Stack(app, "FakeCertScope", {
    env: { account: "123456789012", region: "us-east-1" },
  });

  return acm.Certificate.fromCertificateArn(
    certScope,
    "FakeCertificate",
    "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
  );
}

// SiteStack points lambda.Code.fromAsset at api/src/portfolio/dist, a build
// output that doesn't exist in this checkout - see games-stack.test.ts's
// identical comment for why this needs stubbing.
let fromAssetSpy: MockInstance<typeof lambda.Code.fromAsset>;

beforeAll(() => {
  fromAssetSpy = vi
    .spyOn(lambda.Code, "fromAsset")
    .mockImplementation(
      () => lambda.Code.fromInline("exports.handler = async () => {};") as unknown as lambda.AssetCode
    );
});

afterAll(() => {
  fromAssetSpy.mockRestore();
});

describe("SiteStack", () => {
  it("synthesizes with the GraphQL Lambda, resume table, and site distribution", () => {
    const app = new App();
    const stack = new SiteStack(app, "TestSiteStack", {
      domainName: "www.example.com",
      alternateDomainNames: ["example.com"],
      certificate: fakeCertificate(app),
      hostedZoneId: "Z0000000000000EXAMPLE",
      hostedZoneName: "example.com",
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    // GraphQLFunction + PortfolioCostRefreshFunction, plus CDK's
    // auto-generated custom-resource Lambda for the S3 bucket's
    // autoDeleteObjects.
    template.resourceCountIs("AWS::Lambda::Function", 3);
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "resume",
      DeletionProtectionEnabled: true,
    });
    template.resourceCountIs("AWS::CloudFront::Distribution", 1);
    // Daily proactive refresh of the footer's cost figures - not part of
    // the isTestEnv path below.
    template.resourceCountIs("AWS::Scheduler::Schedule", 1);
    template.hasResourceProperties("AWS::Lambda::Alias", {
      Name: "live",
    });
    // Domain-wide singletons (owned by this, the prod invocation) and real
    // monitoring infra, both absent from the isTestEnv path below.
    template.resourceCountIs("AWS::SES::EmailIdentity", 1);
    template.resourceCountIs("AWS::RUM::AppMonitor", 1);
    // No alias record of its own for the site itself - prod's www/apex
    // were migrated in manually before this stack existed (see app.ts).
    // The SES domain identity above does still auto-manage its own
    // DKIM/MX/SPF records (plain ResourceRecords, not AliasTarget), same
    // as always - only alias records are what "manages its own DNS" means
    // here, so this checks for those specifically rather than a bare count.
    expect(
      Object.values(
        template.findResources("AWS::Route53::RecordSet", { Properties: { AliasTarget: Match.anyValue() } })
      )
    ).toHaveLength(0);
  });

  it("isTestEnv: skips SES/RUM singletons, manages its own DNS, drops table protection", () => {
    const app = new App();
    const stack = new SiteStack(app, "TestEnvSiteStack", {
      domainName: "test.example.com",
      alternateDomainNames: ["www.test.example.com"],
      certificate: fakeCertificate(app),
      hostedZoneId: "Z0000000000000EXAMPLE",
      hostedZoneName: "example.com",
      tableName: "resume-test",
      bucketName: "petertran-au-site-test-123456789012",
      functionName: "portfolio-graphql-test",
      isTestEnv: true,
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "resume-test",
      DeletionProtectionEnabled: false,
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "portfolio-graphql-test",
    });
    template.resourceCountIs("AWS::SES::EmailIdentity", 0);
    template.resourceCountIs("AWS::RUM::AppMonitor", 0);
    template.resourceCountIs("AWS::Cognito::IdentityPool", 0);
    template.resourceCountIs("AWS::Scheduler::Schedule", 0);
    // A + AAAA for both the primary and alternate domain.
    template.resourceCountIs("AWS::Route53::RecordSet", 4);
  });
});
