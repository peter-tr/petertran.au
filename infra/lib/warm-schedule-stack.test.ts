import { describe, it, vi, beforeAll, afterAll, type MockInstance } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { ProvisionedConcurrencyStack } from "./warm-schedule-stack";

// WarmScheduleFunction points lambda.Code.fromAsset at api/dist, a build output
// that doesn't exist in this checkout - see games-stack.test.ts's identical
// comment for why this needs stubbing.
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

describe("ProvisionedConcurrencyStack", () => {
  it("synthesizes with the warm-schedule Lambda, its SSM parameter, and 8 on/off schedules plus the backstop reconcile", () => {
    const app = new App();
    const stack = new ProvisionedConcurrencyStack(app, "TestProvisionedConcurrencyStack", {
      portfolioFnName: "portfolio-graphql",
      pantryFnName: "pantry-graphql",
      imposterFnName: "imposter-graphql",
      zeroTrustLabFnNames: {
        idpBridge: "ztl-idp-bridge",
        internalSts: "ztl-internal-sts",
        edgeAuthorizer: "ztl-edge-authorizer",
        edgeProxy: "ztl-edge-proxy",
        domainA: "ztl-domain-a",
      },
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "warm-schedule",
    });
    template.resourceCountIs("AWS::SSM::Parameter", 1);
    // 2 (on/off) per project (portfolio, pantry, imposter, zeroTrustLab) plus
    // the one backstop reconcile schedule.
    template.resourceCountIs("AWS::Scheduler::Schedule", 9);
  });
});
