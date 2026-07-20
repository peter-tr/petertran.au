import { describe, it, vi, beforeAll, afterAll } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { WarmupStack } from "./warmup-stack";

// WarmupConfigFunction points lambda.Code.fromAsset at api/dist, a build
// output that doesn't exist in this checkout - see games-stack.test.ts's
// identical comment for why this needs stubbing. The 8 warmup targets
// themselves are imported via fromFunctionAttributes (no asset involved).
let fromAssetSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  fromAssetSpy = vi
    .spyOn(lambda.Code, "fromAsset")
    .mockImplementation(() => lambda.Code.fromInline("exports.handler = async () => {};"));
});

afterAll(() => {
  fromAssetSpy.mockRestore();
});

describe("WarmupStack", () => {
  it("synthesizes with a schedule per target plus the warmup-config Lambda", () => {
    const app = new App();
    const stack = new WarmupStack(app, "TestWarmupStack", {
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

    // portfolio, pantry, imposter, and the 5 zero-trust-lab targets.
    template.resourceCountIs("AWS::Scheduler::Schedule", 8);
    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "warmup-config",
    });
  });
});
