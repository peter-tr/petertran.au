import { Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import { Schedule, ScheduleExpression, ScheduleTargetInput } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";

export interface WarmupTarget {
  name: string;
  fn: lambda.IFunction;
}

export interface WarmupSchedulesResult {
  schedules: Schedule[];
  role: iam.Role;
}

/**
 * One EventBridge Scheduler rule per target, each invoking that Lambda
 * directly (bypassing API Gateway/auth entirely) with a fixed
 * `{warmup: true}` payload every 10 minutes - inside the empirical 5-45 min
 * idle-reclaim window, without Provisioned Concurrency's per-second cost.
 * Every target's handler must recognize this payload (see
 * api/src/shared/warmup.ts's `isWarmupPing`) and return immediately, so a
 * scheduled ping is genuinely free of real work, not just cheap.
 *
 * All targets share one execution role (rather than letting each Schedule
 * auto-create its own) - flipping a schedule's State later still requires
 * resending its full definition including the role EventBridge assumes to
 * invoke the target, which needs a single, fixed iam:PassRole target for
 * whoever's doing the toggling.
 */
export function createWarmupSchedules(
  scope: Construct,
  targets: WarmupTarget[],
  namePrefix: string
): WarmupSchedulesResult {
  const role = new iam.Role(scope, "WarmupSchedulerRole", {
    // Explicit, so it reads clearly in the IAM console instead of
    // CloudFormation's auto-generated name.
    roleName: "warmup-scheduler-role",
    assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
  });
  targets.forEach(({ fn }) => fn.grantInvoke(role));

  const schedules = targets.map(
    ({ name, fn }) =>
      new Schedule(scope, `WarmupSchedule-${name}`, {
        scheduleName: `${namePrefix}-${name}`,
        schedule: ScheduleExpression.rate(Duration.minutes(10)),
        target: new LambdaInvoke(fn, {
          input: ScheduleTargetInput.fromObject({ warmup: true }),
          role,
        }),
        description: `Keeps ${name} warm - see api/src/shared/warmup.ts's isWarmupPing for the no-op fast path`,
      })
  );

  return { schedules, role };
}
