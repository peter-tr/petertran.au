import { describe, it, vi, beforeAll, afterAll, type MockInstance } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { SiteStack } from "./site-stack";

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
    // Real app.ts wires this cross-region from CertStack's output; a
    // directly-imported fake ARN avoids the crossRegionReferences plumbing
    // this smoke test doesn't need.
    const certScope = new Stack(app, "FakeCertScope", {
      env: { account: "123456789012", region: "us-east-1" },
    });
    const certificate = acm.Certificate.fromCertificateArn(
      certScope,
      "FakeCertificate",
      "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000"
    );

    const stack = new SiteStack(app, "TestSiteStack", {
      domainName: "www.example.com",
      alternateDomainNames: ["example.com"],
      certificate,
      hostedZoneId: "Z0000000000000EXAMPLE",
      hostedZoneName: "example.com",
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    // GraphQLFunction, plus CDK's auto-generated custom-resource Lambda for
    // the S3 bucket's autoDeleteObjects.
    template.resourceCountIs("AWS::Lambda::Function", 2);
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "resume",
    });
    template.resourceCountIs("AWS::CloudFront::Distribution", 1);
    template.hasResourceProperties("AWS::Lambda::Alias", {
      Name: "live",
    });
  });
});
