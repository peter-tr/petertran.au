import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { createWarmupSchedules, type WarmupTarget } from "./warmup-schedule";

function makeTarget(scope: Stack, name: string): WarmupTarget {
  const fn = new lambda.Function(scope, `${name}Fn`, {
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => {};"),
  });

  return { name, fn };
}

describe("createWarmupSchedules", () => {
  it("creates one Schedule per target, all sharing a single scheduler role", () => {
    const app = new App();
    const stack = new Stack(app, "TestWarmupScheduleStack", {
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const targets = [makeTarget(stack, "alpha"), makeTarget(stack, "beta"), makeTarget(stack, "gamma")];
    const { schedules } = createWarmupSchedules(stack, targets, "warmup-test");

    expect(schedules).toHaveLength(3);

    const template = Template.fromStack(stack);
    template.resourceCountIs("AWS::Scheduler::Schedule", 3);
    // Plus each target Lambda's own execution role (3), which
    // createWarmupSchedules doesn't touch - only asserting the one scheduler
    // role it does create, by name.
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "warmup-scheduler-role",
    });
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: "warmup-test-alpha",
      ScheduleExpression: "rate(10 minutes)",
    });
  });

  it("grants each target's grantInvoke to the shared scheduler role", () => {
    const app = new App();
    const stack = new Stack(app, "TestWarmupScheduleGrantsStack", {
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const targets = [makeTarget(stack, "solo")];
    createWarmupSchedules(stack, targets, "warmup-test");

    const template = Template.fromStack(stack);
    // grantInvoke on the target Lambda for the scheduler role shows up as an
    // AWS::IAM::Policy with an InvokeFunction statement.
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: [
          {
            Action: "lambda:InvokeFunction",
            Effect: "Allow",
          },
        ],
      },
    });
  });
});
