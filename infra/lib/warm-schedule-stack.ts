import { Stack, StackProps, Duration, TimeZone } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Schedule, ScheduleExpression, ScheduleTargetInput } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import * as path from "path";
import { FUNCTION_NAMES, LIVE_ALIAS_NAME, liveAliasArn } from "./shared/function-names";

export interface ZeroTrustLabFunctionNames {
  idpBridge: string;
  internalSts: string;
  edgeAuthorizer: string;
  edgeProxy: string;
  domainA: string;
}

export interface ProvisionedConcurrencyStackProps extends StackProps {
  // Plain function *names* (not live lambda.IFunction references) - a live
  // reference passed cross-stack becomes a CloudFormation export that blocks
  // the producing stack from ever replacing that Lambda for as long as this
  // stack has it imported.
  portfolioFnName: string;
  pantryFnName: string;
  imposterFnName: string;
  supergraphFnName: string;
  zeroTrustLabFnNames: ZeroTrustLabFunctionNames;
}

const WARM_SCHEDULE_PARAM_NAME = "/petertran-au/warm-schedule";

type WarmScheduleKey = "portfolio" | "pantry" | "imposter" | "supergraph" | "zeroTrustLab";
type Weekday = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

interface WarmSchedule {
  enabled: boolean;
  days: Weekday[];
  start: string; // "HH:MM", 24h, Sydney-local
  end: string; // "HH:MM"
  concurrency: number; // ProvisionedConcurrentExecutions granted while within window
}

const ALL_WEEKDAYS: Weekday[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
// Every project's initial schedule, seeded into both the SSM parameter and
// the 8 on/off EventBridge Schedules below - matches this stack's original
// fixed 8am-7pm window. Not shared with api/src/warm-schedule/handler.ts's own
// DEFAULT_CONFIG constant (same "CDK seeds the initial value, the Lambda has
// its own fallback" duplication this stack already had before this change).
const DEFAULT_SCHEDULE: WarmSchedule = {
  enabled: true,
  days: ALL_WEEKDAYS,
  start: "08:00",
  end: "19:00",
  concurrency: 1,
};

const WARM_SCHEDULE_PROJECTS: WarmScheduleKey[] = [
  "portfolio",
  "pantry",
  "imposter",
  "supergraph",
  "zeroTrustLab",
];
// Slug used in each project's on/off Schedule name - "zero-trust-lab", not
// the camelCase flag key, to match this codebase's EventBridge Schedule
// naming convention elsewhere (e.g. the old warmup-* names).
const WARM_SCHEDULE_PROJECT_SLUGS: Record<WarmScheduleKey, string> = {
  portfolio: "portfolio",
  pantry: "pantry",
  imposter: "imposter",
  supergraph: "supergraph",
  zeroTrustLab: "zero-trust-lab",
};

function cronOptionsFor(days: Weekday[], time: string) {
  const [hour, minute] = time.split(":");

  return { minute, hour, weekDay: days.join(","), timeZone: TimeZone.AUSTRALIA_SYDNEY };
}

// Plain string, not `schedule.scheduleArn` (a Fn::GetAtt token) - warmScheduleFn's
// own IAM policy needs to reference these same on/off schedules, and since
// their target is warmScheduleFn itself, a token-based reference would create a
// real CloudFormation dependency cycle (policy -> schedule -> warmScheduleFn ->
// policy). The name is one we chose ourselves, so the ARN is fully known at
// synth time; "default" is EventBridge Scheduler's group when none is set.
function warmScheduleArn(region: string, account: string, name: string): string {
  return `arn:aws:scheduler:${region}:${account}:schedule/default/${name}`;
}

/**
 * Scheduled Provisioned Concurrency (PC) for portfolio/pantry/imposter/
 * supergraph's and zero-trust-lab's 5 Lambdas' `live` alias, per-project
 * configurable days/times (Sydney), settable from the portfolio Settings page.
 * zero-trust-lab gets no organic traffic (see the old warmup schedule's
 * design notes in docs/warmup-and-provisioned-concurrency.md), so its PC
 * only speeds up manual testing/demos - kept as one combined `zeroTrustLab`
 * schedule (not 5 independent ones) since the 5 Lambdas only work as a
 * pipeline together. Deliberately its own stack, same reasoning as the
 * (now-removed) WarmupStack: this is a cross-cutting cost/latency concern
 * that doesn't belong to any one producing stack.
 *
 * Doesn't use CDK's native `Alias.addAutoScaling()` / Application Auto
 * Scaling scheduled actions - that construct's "a suspended scheduled
 * action doesn't retroactively undo already-provisioned capacity" behavior
 * would mean flipping the settings-page toggle off mid-day leaves PC (and
 * its cost) running until the next scheduled tick, possibly hours later.
 *
 * Instead, each project gets two EventBridge Schedules - `warm-on-<project>`/
 * `warm-off-<project>` - built from AWS cron's native day-of-week support, so
 * PC flips at the exact configured minute with no polling. A settings-page
 * edit updates those two schedules' cron expressions/State via
 * `UpdateScheduleCommand` (see warm-schedule/handler.ts's
 * `updateProjectSchedules`) and reconciles that project's live PC state
 * immediately, so a toggle/edit never waits for the next trigger. A coarser
 * periodic reconcile (every 30 min, `WarmScheduleReconcile` below) stays as a
 * backstop to self-heal a missed on/off trigger - it doesn't drive the
 * window's precision, the exact triggers do.
 */
export class ProvisionedConcurrencyStack extends Stack {
  constructor(scope: Construct, id: string, props: ProvisionedConcurrencyStackProps) {
    super(scope, id, props);

    // On by default, matching the 8am-7pm-every-day window this stack always
    // had - the actual gating (per-project enabled/days/start/end) is
    // handler-side logic (see warm-schedule/handler.ts's isWithinWindow), not
    // baked into this parameter, so it can change without a redeploy.
    //
    // DO NOT EDIT THIS LITERAL to add/remove a project. CloudFormation owns
    // this parameter's Value declaratively: every deploy diffs this computed
    // string against what the *previous* deployed template had, and if it
    // differs, overwrites the live value with it - clobbering whatever the
    // settings page has since written via PutParameter, since those runtime
    // writes are invisible to CloudFormation's diff. Adding `supergraph`
    // here on 2026-07-21 did exactly that: it reset every project's
    // real, user-configured schedule back to this DEFAULT_SCHEDULE literal
    // the moment that PR deployed (confirmed via WarmScheduleParam's
    // UPDATE_COMPLETE stack event at that deploy's timestamp) - see
    // docs/warmup-and-provisioned-concurrency.md.
    //
    // A newly added project needs no change here at all: handler.ts's
    // getConfig() already merges `{ ...DEFAULT_CONFIG[key], ...stored[key] }`
    // per project, so any key missing from the stored value (e.g. a project
    // added after this parameter was first written) is backfilled from
    // DEFAULT_CONFIG at read time. This literal only ever seeds the
    // parameter's very first creation.
    const scheduleParam = new ssm.StringParameter(this, "WarmScheduleParam", {
      parameterName: WARM_SCHEDULE_PARAM_NAME,
      stringValue: JSON.stringify({
        portfolio: DEFAULT_SCHEDULE,
        pantry: DEFAULT_SCHEDULE,
        imposter: DEFAULT_SCHEDULE,
        supergraph: DEFAULT_SCHEDULE,
        zeroTrustLab: DEFAULT_SCHEDULE,
      }),
    });

    const ztl = props.zeroTrustLabFnNames;
    const targetFnNames = [
      props.portfolioFnName,
      props.pantryFnName,
      props.imposterFnName,
      props.supergraphFnName,
      ztl.idpBridge,
      ztl.internalSts,
      ztl.edgeAuthorizer,
      ztl.edgeProxy,
      ztl.domainA,
    ];

    // Plain names, computed before the Schedules themselves exist - the
    // warm-schedule Lambda only needs to know what each schedule is *called*
    // (to Get/UpdateSchedule it by name), not a live construct reference.
    const scheduleNames = Object.fromEntries(
      WARM_SCHEDULE_PROJECTS.map((key) => {
        const slug = WARM_SCHEDULE_PROJECT_SLUGS[key];

        return [key, { on: `warm-on-${slug}`, off: `warm-off-${slug}` }];
      })
    );

    const warmScheduleFn = new lambda.Function(this, "WarmScheduleFunction", {
      // Explicit, so it reads clearly in the X-Ray trace map instead of
      // CloudFormation's auto-generated name. Also lets ApiGatewayStack
      // reference it by a plain string - see FUNCTION_NAMES's doc comment.
      functionName: FUNCTION_NAMES.warmSchedule,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "warm-schedule/handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/dist")),
      memorySize: 128,
      timeout: Duration.seconds(10),
      environment: {
        LIVE_ALIAS_NAME,
        WARM_SCHEDULE_PARAM_NAME: scheduleParam.parameterName,
        PORTFOLIO_FN_NAME: props.portfolioFnName,
        PANTRY_FN_NAME: props.pantryFnName,
        IMPOSTER_FN_NAME: props.imposterFnName,
        SUPERGRAPH_FN_NAME: props.supergraphFnName,
        ZTL_IDP_BRIDGE_FN_NAME: ztl.idpBridge,
        ZTL_INTERNAL_STS_FN_NAME: ztl.internalSts,
        ZTL_EDGE_AUTHORIZER_FN_NAME: ztl.edgeAuthorizer,
        ZTL_EDGE_PROXY_FN_NAME: ztl.edgeProxy,
        ZTL_DOMAIN_A_FN_NAME: ztl.domainA,
        WARM_SCHEDULE_NAMES: JSON.stringify(scheduleNames),
      },
    });
    scheduleParam.grantRead(warmScheduleFn);
    scheduleParam.grantWrite(warmScheduleFn);

    warmScheduleFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "lambda:GetProvisionedConcurrencyConfig",
          "lambda:PutProvisionedConcurrencyConfig",
          "lambda:DeleteProvisionedConcurrencyConfig",
        ],
        resources: targetFnNames.map((name) => liveAliasArn(this.region, this.account, name)),
      })
    );

    // Shared by every project's on/off schedule below (rather than letting
    // each auto-create its own) - flipping a schedule's cron/State later
    // still requires resending its full definition including the role
    // EventBridge assumes to invoke the target, which needs a single, fixed
    // iam:PassRole target for warmScheduleFn to do that toggling.
    const schedulerRole = new iam.Role(this, "WarmScheduleSchedulerRole", {
      roleName: "warm-schedule-role",
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
    });
    warmScheduleFn.grantInvoke(schedulerRole);

    for (const key of WARM_SCHEDULE_PROJECTS) {
      const slug = WARM_SCHEDULE_PROJECT_SLUGS[key];

      new Schedule(this, `WarmOnSchedule-${slug}`, {
        scheduleName: scheduleNames[key].on,
        schedule: ScheduleExpression.cron(cronOptionsFor(DEFAULT_SCHEDULE.days, DEFAULT_SCHEDULE.start)),
        target: new LambdaInvoke(warmScheduleFn, {
          input: ScheduleTargetInput.fromObject({ project: key, action: "on" }),
          role: schedulerRole,
        }),
        description: `Turns on Provisioned Concurrency for ${key} at its configured start time`,
      });
      new Schedule(this, `WarmOffSchedule-${slug}`, {
        scheduleName: scheduleNames[key].off,
        schedule: ScheduleExpression.cron(cronOptionsFor(DEFAULT_SCHEDULE.days, DEFAULT_SCHEDULE.end)),
        target: new LambdaInvoke(warmScheduleFn, {
          input: ScheduleTargetInput.fromObject({ project: key, action: "off" }),
          role: schedulerRole,
        }),
        description: `Turns off Provisioned Concurrency for ${key} at its configured end time`,
      });
    }

    warmScheduleFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["scheduler:GetSchedule", "scheduler:UpdateSchedule"],
        resources: Object.values(scheduleNames).flatMap((names: { on: string; off: string }) => [
          warmScheduleArn(this.region, this.account, names.on),
          warmScheduleArn(this.region, this.account, names.off),
        ]),
      })
    );
    warmScheduleFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [schedulerRole.roleArn],
      })
    );

    // Backstop only - self-heals a missed on/off trigger (e.g. a transient
    // Lambda error) within at most 30 min. Doesn't drive the window's
    // precision, the exact per-project triggers above do that.
    new Schedule(this, "WarmScheduleReconcile", {
      schedule: ScheduleExpression.rate(Duration.minutes(30)),
      target: new LambdaInvoke(warmScheduleFn, {
        input: ScheduleTargetInput.fromObject({ reconcile: true }),
      }),
      description:
        "Backstop reconcile of scheduled Provisioned Concurrency for " +
        "portfolio/pantry/imposter/supergraph/zero-trust-lab",
    });
  }
}
