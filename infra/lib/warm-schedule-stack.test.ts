import { describe, it, expect, vi, beforeAll, afterAll, type MockInstance } from "vitest";
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
  it("synthesizes with the warm-schedule Lambda, its 3 SSM parameters, and 12 on/off schedules plus the backstop reconcile", () => {
    const app = new App();
    const stack = new ProvisionedConcurrencyStack(app, "TestProvisionedConcurrencyStack", {
      portfolioFnName: "portfolio-graphql",
      pantryFnName: "pantry-graphql",
      imposterFnName: "imposter-graphql",
      supergraphFnName: "supergraph-graphql",
      designStudioFnName: "design-studio-graphql",
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
    // Schedule config, profiles, and reactive-warm runtime state - see
    // WARM_SCHEDULE_REACTIVE_STATE_PARAM_NAME's doc comment for why the
    // latter is a separate parameter from the schedule config.
    template.resourceCountIs("AWS::SSM::Parameter", 3);
    // 2 (on/off) per project (portfolio, pantry, imposter, supergraph,
    // designStudio, zeroTrustLab) plus the one backstop reconcile schedule.
    template.resourceCountIs("AWS::Scheduler::Schedule", 13);
  });

  it("subscribes every target's log group to the cold-start filter, one SubscriptionFilter per target", () => {
    const app = new App();
    const stack = new ProvisionedConcurrencyStack(app, "TestProvisionedConcurrencyStack", {
      portfolioFnName: "portfolio-graphql",
      pantryFnName: "pantry-graphql",
      imposterFnName: "imposter-graphql",
      supergraphFnName: "supergraph-graphql",
      designStudioFnName: "design-studio-graphql",
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

    // 5 (portfolio, pantry, imposter, supergraph, designStudio) + 5 (ztl's
    // own Lambdas) = 10 targets, one subscription each.
    template.resourceCountIs("AWS::Logs::SubscriptionFilter", 10);
    template.hasResourceProperties("AWS::Logs::SubscriptionFilter", {
      FilterPattern: '"Init Duration"',
    });
  });

  // Regression test for a real incident (#232 shipped healWeightedAlias,
  // which calls GetAlias on every reconcileTarget tick, without ever
  // granting lambda:GetAlias) - every reconcile for every project silently
  // failed with AccessDeniedException before ever reaching the actual PC
  // grant/delete call, confirmed live via warm-schedule's own CloudWatch
  // Logs. GetAlias is the read counterpart of UpdateAlias/CreateAlias/
  // DeleteAlias and resolves against the bare function ARN, same as those.
  it("grants lambda:GetAlias against the bare function ARN, alongside the other alias CRUD actions", () => {
    const app = new App();
    const stack = new ProvisionedConcurrencyStack(app, "TestProvisionedConcurrencyStack", {
      portfolioFnName: "portfolio-graphql",
      pantryFnName: "pantry-graphql",
      imposterFnName: "imposter-graphql",
      supergraphFnName: "supergraph-graphql",
      designStudioFnName: "design-studio-graphql",
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

    const policies = Object.values(template.findResources("AWS::IAM::Policy")) as Array<{
      Properties: { PolicyDocument: { Statement: Array<{ Action: string | string[] }> } };
    }>;
    const statements = policies.flatMap((p) => p.Properties.PolicyDocument.Statement);
    const aliasStatement = statements.find(
      (s) => Array.isArray(s.Action) && s.Action.includes("lambda:UpdateAlias")
    );

    expect(aliasStatement?.Action).toContain("lambda:GetAlias");
  });
});
