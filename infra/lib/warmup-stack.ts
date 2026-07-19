import { Stack, StackProps, CfnOutput, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import { createWarmupSchedules, type WarmupTarget } from "./shared/warmup-schedule";

export interface ZeroTrustLabWarmupFunctionNames {
  idpBridge: string;
  internalSts: string;
  edgeAuthorizer: string;
  edgeProxy: string;
  domainA: string;
}

export interface WarmupStackProps extends StackProps {
  domainName: string;
  alternateDomainNames?: string[];
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

    const targets: WarmupTarget[] = [
      { name: "portfolio", fn: lambda.Function.fromFunctionName(this, "PortfolioFn", props.portfolioFnName) },
      { name: "pantry", fn: lambda.Function.fromFunctionName(this, "PantryFn", props.pantryFnName) },
      { name: "imposter", fn: lambda.Function.fromFunctionName(this, "ImposterFn", props.imposterFnName) },
      {
        name: "zero-trust-lab-idp-bridge",
        fn: lambda.Function.fromFunctionName(this, "ZtlIdpBridgeFn", props.zeroTrustLabFnNames.idpBridge),
      },
      {
        name: "zero-trust-lab-internal-sts",
        fn: lambda.Function.fromFunctionName(this, "ZtlInternalStsFn", props.zeroTrustLabFnNames.internalSts),
      },
      {
        name: "zero-trust-lab-edge-authorizer",
        fn: lambda.Function.fromFunctionName(
          this,
          "ZtlEdgeAuthorizerFn",
          props.zeroTrustLabFnNames.edgeAuthorizer
        ),
      },
      {
        name: "zero-trust-lab-edge-proxy",
        fn: lambda.Function.fromFunctionName(this, "ZtlEdgeProxyFn", props.zeroTrustLabFnNames.edgeProxy),
      },
      {
        name: "zero-trust-lab-domain-a",
        fn: lambda.Function.fromFunctionName(this, "ZtlDomainAFn", props.zeroTrustLabFnNames.domainA),
      },
    ];

    const { schedules, role } = createWarmupSchedules(this, targets, SCHEDULE_NAME_PREFIX);

    const configFn = new lambda.Function(this, "WarmupConfigFunction", {
      // Explicit, so it reads clearly in the X-Ray trace map instead of
      // CloudFormation's auto-generated name.
      functionName: "warmup-config",
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "warmup/handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../api/dist")),
      memorySize: 128,
      timeout: Duration.seconds(10),
      environment: {
        SCHEDULE_NAMES: targets.map((t) => `${SCHEDULE_NAME_PREFIX}-${t.name}`).join(","),
      },
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

    const configFnUrl = configFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: [
          `https://${props.domainName}`,
          ...(props.alternateDomainNames ?? []).map((d) => `https://${d}`),
          "http://localhost:5173",
          "http://localhost:3000",
        ],
        allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST],
        allowedHeaders: ["content-type"],
        maxAge: Duration.hours(1),
      },
    });

    // Public and unauthenticated, same as every other Function URL in this
    // codebase - all it does is flip the warmup schedules on/off, which has
    // no security or cost consequence worth gating behind auth.
    new CfnOutput(this, "WarmupConfigUrl", { value: configFnUrl.url });
  }
}
