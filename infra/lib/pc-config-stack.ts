import { Stack, StackProps, Duration, TimeZone } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Schedule, ScheduleExpression, ScheduleTargetInput } from "aws-cdk-lib/aws-scheduler";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import * as path from "path";
import { FUNCTION_NAMES, LIVE_ALIAS_NAME, liveAliasArn } from "./shared/function-names";
import type { ZeroTrustLabWarmupFunctionNames } from "./warmup-stack";

export interface ProvisionedConcurrencyStackProps extends StackProps {
  // Plain function *names* (not live lambda.IFunction references) - same
  // reasoning as WarmupStack (see its doc comment).
  portfolioFnName: string;
  pantryFnName: string;
  imposterFnName: string;
  // Reuses WarmupStack's shape rather than redefining it - same 5 names,
  // same "plain string" convention.
  zeroTrustLabFnNames: ZeroTrustLabWarmupFunctionNames;
}

const PC_CONFIG_PARAM_NAME = "/petertran-au/pc-config";

/**
 * Scheduled Provisioned Concurrency (PC) for portfolio/pantry/imposter's,
 * and zero-trust-lab's 5 Lambdas', `live` alias, 8am-7pm Australia/Sydney.
 * For portfolio/pantry/imposter this eliminates cold starts for real
 * visitors during business hours; zero-trust-lab gets no organic traffic
 * (see warmup-schedule.ts's doc comment), so its PC only speeds up manual
 * testing/demos of the lab - kept as one combined `zeroTrustLab` flag (not
 * 5 independent ones) since the 5 Lambdas only work as a pipeline together.
 * Deliberately its own stack, same reasoning as WarmupStack: this is a
 * cross-cutting cost/latency concern that doesn't belong to any one
 * producing stack.
 *
 * Doesn't use CDK's native `Alias.addAutoScaling()` / Application Auto
 * Scaling scheduled actions - that construct's "a suspended scheduled
 * action doesn't retroactively undo already-provisioned capacity" behavior
 * would mean flipping the settings-page toggle off mid-day leaves PC (and
 * its cost) running until the next scheduled tick, possibly hours later.
 * Instead, one small Lambda (pc-config, mirroring warmup-config's
 * directly-manipulate-live-state idiom - see warmup-stack.ts) directly calls
 * Put/DeleteProvisionedConcurrencyConfig, both on an hourly reconcile tick
 * and immediately on every settings-page toggle, so a toggle takes effect
 * right away regardless of time of day.
 */
export class ProvisionedConcurrencyStack extends Stack {
  constructor(scope: Construct, id: string, props: ProvisionedConcurrencyStackProps) {
    super(scope, id, props);

    // On by default, matching how warmup's schedules are also ENABLED at
    // creation - the actual gating (business hours or not) is handler-side
    // logic (see pc-config/handler.ts's isWithinSydneyBusinessHours), not
    // baked into this parameter or the schedule below, so either can change
    // without a redeploy.
    const configParam = new ssm.StringParameter(this, "PcConfigParam", {
      parameterName: PC_CONFIG_PARAM_NAME,
      stringValue: JSON.stringify({ portfolio: true, pantry: true, imposter: true, zeroTrustLab: true }),
    });

    const ztl = props.zeroTrustLabFnNames;
    const targetFnNames = [
      props.portfolioFnName,
      props.pantryFnName,
      props.imposterFnName,
      ztl.idpBridge,
      ztl.internalSts,
      ztl.edgeAuthorizer,
      ztl.edgeProxy,
      ztl.domainA,
    ];

    const configFn = new lambda.Function(this, "PcConfigFunction", {
      // Explicit, so it reads clearly in the X-Ray trace map instead of
      // CloudFormation's auto-generated name. Also lets ApiGatewayStack
      // reference it by a plain string - see FUNCTION_NAMES's doc comment.
      functionName: FUNCTION_NAMES.pcConfig,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "pc-config/handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/dist")),
      memorySize: 128,
      timeout: Duration.seconds(10),
      environment: {
        LIVE_ALIAS_NAME,
        PC_CONFIG_PARAM_NAME: configParam.parameterName,
        PORTFOLIO_FN_NAME: props.portfolioFnName,
        PANTRY_FN_NAME: props.pantryFnName,
        IMPOSTER_FN_NAME: props.imposterFnName,
        ZTL_IDP_BRIDGE_FN_NAME: ztl.idpBridge,
        ZTL_INTERNAL_STS_FN_NAME: ztl.internalSts,
        ZTL_EDGE_AUTHORIZER_FN_NAME: ztl.edgeAuthorizer,
        ZTL_EDGE_PROXY_FN_NAME: ztl.edgeProxy,
        ZTL_DOMAIN_A_FN_NAME: ztl.domainA,
      },
    });
    configParam.grantRead(configFn);
    configParam.grantWrite(configFn);

    configFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "lambda:GetProvisionedConcurrencyConfig",
          "lambda:PutProvisionedConcurrencyConfig",
          "lambda:DeleteProvisionedConcurrencyConfig",
        ],
        resources: targetFnNames.map((name) => liveAliasArn(this.region, this.account, name)),
      })
    );

    // Fires every hour on the hour, Sydney-local - same idiom as
    // PantryDigestSchedule (infra/lib/pantry-stack.ts). The handler no-ops
    // (deletes PC) for any flag that's off or outside 8am-7pm.
    new Schedule(this, "PcReconcileSchedule", {
      schedule: ScheduleExpression.cron({ minute: "0", hour: "*", timeZone: TimeZone.AUSTRALIA_SYDNEY }),
      target: new LambdaInvoke(configFn, {
        input: ScheduleTargetInput.fromObject({ reconcile: true }),
      }),
      description:
        "Hourly reconcile of scheduled Provisioned Concurrency for portfolio/pantry/imposter/zero-trust-lab",
    });
  }
}
