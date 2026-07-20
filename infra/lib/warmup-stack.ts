import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import { createWarmupSchedules, type WarmupTarget } from "./shared/warmup-schedule";
import { FUNCTION_NAMES, liveAliasArn } from "./shared/function-names";

export interface ZeroTrustLabWarmupFunctionNames {
  idpBridge: string;
  internalSts: string;
  edgeAuthorizer: string;
  edgeProxy: string;
  domainA: string;
}

export interface WarmupStackProps extends StackProps {
  // Plain function *names* (not live lambda.IFunction references)
  // deliberately - see the class doc comment below for why.
  portfolioFnName: string;
  pantryFnName: string;
  imposterFnName: string;
  zeroTrustLabFnNames: ZeroTrustLabWarmupFunctionNames;
}

const SCHEDULE_NAME_PREFIX = "warmup";

/**
 * Keeps every project's Lambda warm on a schedule, with a toggle exposed to
 * the portfolio site's settings page. Deliberately its own stack, not folded
 * into any producing stack: warming is an operational/cost concern that cuts
 * across portfolio, pantry, imposter, and zero-trust-lab equally, so it
 * doesn't belong to any one of them.
 *
 * Takes each target's *function name* (a plain string, from each producing
 * stack's explicit `functionName` prop), not a live construct reference. A
 * live reference passed as a cross-stack prop becomes a real CloudFormation
 * export - which then blocks the producing stack from ever replacing that
 * Lambda (e.g. any property change CloudFormation can't update in place)
 * for as long as this stack has it imported. Hit exactly this the first time
 * this stack was built. `Function.fromFunctionName` below resolves the same
 * function without creating that export.
 */
export class WarmupStack extends Stack {
  constructor(scope: Construct, id: string, props: WarmupStackProps) {
    super(scope, id, props);

    // portfolio/pantry/imposter ping the `live` alias (not bare $LATEST) -
    // that's the qualifier ApiGatewayStack routes real traffic to and
    // ProvisionedConcurrencyStack applies PC to, so warmup pings outside the
    // 8am-7pm PC window keep warming the same qualifier real visitors hit.
    // Pinging $LATEST here instead would warm an environment nobody uses.
    const liveAlias = (id: string, fnName: string) =>
      lambda.Function.fromFunctionAttributes(this, id, {
        functionArn: liveAliasArn(this.region, this.account, fnName),
        sameEnvironment: true,
      });

    const targets: WarmupTarget[] = [
      { name: "portfolio", fn: liveAlias("PortfolioAlias", props.portfolioFnName) },
      { name: "pantry", fn: liveAlias("PantryAlias", props.pantryFnName) },
      { name: "imposter", fn: liveAlias("ImposterAlias", props.imposterFnName) },
      // zero-trust-lab's 5 now ping the `live` alias too, same reasoning as
      // portfolio/pantry/imposter above - ProvisionedConcurrencyStack applies
      // PC to that qualifier, not $LATEST, so pinging $LATEST here would warm
      // an environment nothing (not even PC) ever uses.
      {
        name: "zero-trust-lab-idp-bridge",
        fn: liveAlias("ZtlIdpBridgeAlias", props.zeroTrustLabFnNames.idpBridge),
      },
      {
        name: "zero-trust-lab-internal-sts",
        fn: liveAlias("ZtlInternalStsAlias", props.zeroTrustLabFnNames.internalSts),
      },
      {
        name: "zero-trust-lab-edge-authorizer",
        fn: liveAlias("ZtlEdgeAuthorizerAlias", props.zeroTrustLabFnNames.edgeAuthorizer),
      },
      {
        name: "zero-trust-lab-edge-proxy",
        fn: liveAlias("ZtlEdgeProxyAlias", props.zeroTrustLabFnNames.edgeProxy),
      },
      {
        name: "zero-trust-lab-domain-a",
        fn: liveAlias("ZtlDomainAAlias", props.zeroTrustLabFnNames.domainA),
      },
    ];

    const { schedules, role } = createWarmupSchedules(this, targets, SCHEDULE_NAME_PREFIX);

    const configFn = new lambda.Function(this, "WarmupConfigFunction", {
      // Explicit, so it reads clearly in the X-Ray trace map instead of
      // CloudFormation's auto-generated name. Also lets ApiGatewayStack
      // reference it by a plain string - see FUNCTION_NAMES's doc comment.
      functionName: FUNCTION_NAMES.warmupConfig,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "warmup/handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/dist")),
      memorySize: 128,
      timeout: Duration.seconds(10),
      environment: {
        SCHEDULE_NAMES: targets.map((t) => `${SCHEDULE_NAME_PREFIX}-${t.name}`).join(","),
      },
      tracing: lambda.Tracing.ACTIVE,
    });
    configFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["scheduler:GetSchedule", "scheduler:UpdateSchedule"],
        resources: schedules.map((s) => s.scheduleArn),
      })
    );
    // UpdateSchedule resends the target's role too, so the caller needs
    // PassRole on it - not just permission to touch the schedule itself.
    configFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [role.roleArn],
      })
    );
  }
}
