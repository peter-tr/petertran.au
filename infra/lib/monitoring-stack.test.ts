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

  it("dashboard has a compact alarm-status widget, bar graphs for counts, a latency graph, and a GraphQL-operations Logs Insights widget per project", () => {
    const app = new App();
    const stack = new MonitoringStack(app, "TestMonitoringStack", {
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const body = dashboardBodyText(Template.fromStack(stack));

    expect(body).toContain('"title":"Alarms"');
    expect(body).toContain('"title":"Latency (p50 / p99)"');
    expect(body).toContain('"title":"Invocations"');
    expect(body).toContain('"title":"Errors & throttles"');
    // Bar, not the default line/timeSeries view - see the widget's own doc
    // comment on why sparse event counts read better as bars.
    expect(body).toContain('"view":"bar"');
    // The GraphQL-operations widget is a Logs Insights query ("type":"log"),
    // not a metric graph, since operation names aren't known at synth time.
    expect(body).toContain('"title":"GraphQL operations by name"');
    expect(body).toContain('"type":"log"');
    expect(body).toContain("stats sum(OperationCount) as count by operationName");
  });

  it("isTestEnv: dashboard-only - no alarms, no SNS topic, no AlertsSettingsFunction, uses the test env's own Lambdas", () => {
    const app = new App();
    const stack = new MonitoringStack(app, "TestTestMonitoringStack", {
      isTestEnv: true,
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::SNS::Topic", 0);
    template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    // Only the 4 test-env GraphQL Lambdas' log groups are ever referenced -
    // no AlertsSettingsFunction (prod-only), no digest/price-check/
    // warm-schedule/zero-trust-lab (not part of what the test env exists to
    // validate - see TEST_FUNCTIONS's doc comment).
    template.resourceCountIs("AWS::Lambda::Function", 0);
    template.hasResourceProperties("AWS::CloudWatch::Dashboard", { DashboardName: "petertran-au-test" });

    const body = dashboardBodyText(template);
    expect(body).toContain("portfolio-graphql-test");
    expect(body).toContain("pantry-graphql-test");
    expect(body).toContain("imposter-graphql-test");
    expect(body).toContain("supergraph-graphql-test");
    expect(body).not.toContain('"title":"Alarms"');
  });
});

// Widget content lives inside DashboardBody's Fn::Join (the topic/table ARNs
// interpolated into metric dimensions are CFN tokens, so the whole body
// isn't a plain string) - concatenating just the literal string fragments
// is enough to substring-search for expected widget titles/types.
function dashboardBodyText(template: Template): string {
  const [dashboard] = Object.values(template.findResources("AWS::CloudWatch::Dashboard"));
  const join = (dashboard.Properties.DashboardBody as { "Fn::Join": [string, unknown[]] })["Fn::Join"];

  return join[1].filter((part): part is string => typeof part === "string").join("");
}
