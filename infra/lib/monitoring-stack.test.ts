import { describe, it, expect, vi, beforeAll, afterAll, type MockInstance } from "vitest";
import { App } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { MonitoringStack } from "./monitoring-stack";

// AlertsSettingsFunction points lambda.Code.fromAsset at api/dist, a build
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

describe("MonitoringStack", () => {
  it("synthesizes an SNS topic, an Errors/Throttles/Duration alarm per monitored Lambda, and a dashboard", () => {
    const app = new App();
    const stack = new MonitoringStack(app, "TestMonitoringStack", {
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::SNS::Topic", 1);
    template.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: "peter2002tran@outlook.com",
    });

    // 12 monitored Lambdas x 3 alarms each (Errors, Throttles, Duration).
    template.resourceCountIs("AWS::CloudWatch::Alarm", 36);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "portfolio-graphql-errors",
      Threshold: 1,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "pantry-price-check-duration-p99",
      // 80% of its 600s timeout, in ms.
      Threshold: 480000,
      EvaluationPeriods: 3,
      DatapointsToAlarm: 2,
    });

    template.resourceCountIs("AWS::CloudWatch::Dashboard", 1);
  });

  it("synthesizes AlertsSettingsFunction with sns:ListSubscriptionsByTopic scoped to the topic and sns:*SubscriptionAttributes on *", () => {
    const app = new App();
    const stack = new MonitoringStack(app, "TestMonitoringStack", {
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "alerts-settings",
      Handler: "alerts-settings/handler.handler",
      Environment: {
        Variables: Match.objectLike({ ALARM_EMAIL: "peter2002tran@outlook.com" }),
      },
    });
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: "sns:ListSubscriptionsByTopic", Resource: { Ref: Match.anyValue() } }),
          // Resource: "*", not a scoped `topicArn:*` wildcard - confirmed
          // live that AWS's IAM engine doesn't match that pattern against a
          // real subscription ARN for these two actions (see
          // monitoring-stack.ts's doc comment on this statement).
          Match.objectLike({
            Action: ["sns:GetSubscriptionAttributes", "sns:SetSubscriptionAttributes"],
            Resource: "*",
          }),
        ]),
      },
    });
  });

  it("doesn't create or reference any test-env-suffixed function/table names", () => {
    const app = new App();
    const stack = new MonitoringStack(app, "TestMonitoringStack", {
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const json = JSON.stringify(Template.fromStack(stack).toJSON());

    expect(json).not.toContain("-test");
  });
});
