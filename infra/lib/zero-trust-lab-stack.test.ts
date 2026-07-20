import { describe, it, vi, beforeAll, afterAll } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { ZeroTrustLabStack } from "./zero-trust-lab-stack";

// ZeroTrustLabStack points lambda.Code.fromAsset at api/dist, a build output
// that doesn't exist in this checkout - see games-stack.test.ts's identical
// comment for why this needs stubbing.
let fromAssetSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  fromAssetSpy = vi
    .spyOn(lambda.Code, "fromAsset")
    .mockImplementation(() => lambda.Code.fromInline("exports.handler = async () => {};"));
});

afterAll(() => {
  fromAssetSpy.mockRestore();
});

describe("ZeroTrustLabStack", () => {
  it("synthesizes with the 5 pipeline Lambdas, the sessions table, and the KMS signing key", () => {
    const app = new App();
    const stack = new ZeroTrustLabStack(app, "TestZeroTrustLabStack", {
      domainName: "www.example.com",
      alternateDomainNames: ["example.com"],
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    // IdpBridge, InternalSts, EdgeAuthorizer, EdgeProxy, DomainA.
    template.resourceCountIs("AWS::Lambda::Function", 5);
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "ztl-sessions",
    });
    template.resourceCountIs("AWS::KMS::Key", 1);
    template.resourceCountIs("AWS::Cognito::UserPool", 1);
    // EdgeHttpApi + DomainAHttpApi.
    template.resourceCountIs("AWS::ApiGatewayV2::Api", 2);
  });
});
