import { Stack, StackProps, CfnOutput, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import { createWarmupSchedules, type WarmupTarget } from "./shared/warmup-schedule";

export interface ZeroTrustLabWarmupFunctions {
  idpBridge: lambda.IFunction;
  internalSts: lambda.IFunction;
  edgeAuthorizer: lambda.IFunction;
  edgeProxy: lambda.IFunction;
  domainA: lambda.IFunction;
}

export interface WarmupStackProps extends StackProps {
  domainName: string;
  alternateDomainNames?: string[];
  portfolioFn: lambda.IFunction;
  pantryFn: lambda.IFunction;
  imposterFn: lambda.IFunction;
  zeroTrustLabFns: ZeroTrustLabWarmupFunctions;
}

const SCHEDULE_NAME_PREFIX = "warmup";

/**
 * Keeps every project's Lambda warm on a schedule, with a toggle exposed to
 * the portfolio site's settings page. Deliberately its own stack, not folded
 * into any producing stack: warming is an operational/cost concern that cuts
 * across portfolio, pantry, imposter, and zero-trust-lab equally, so it
 * doesn't belong to any one of them. Each producing stack exposes its own
 * Lambda(s) as a public property and knows nothing about warmup at all.
 */
export class WarmupStack extends Stack {
  constructor(scope: Construct, id: string, props: WarmupStackProps) {
    super(scope, id, props);

    const targets: WarmupTarget[] = [
      { name: "portfolio", fn: props.portfolioFn },
      { name: "pantry", fn: props.pantryFn },
      { name: "imposter", fn: props.imposterFn },
      { name: "zero-trust-lab-idp-bridge", fn: props.zeroTrustLabFns.idpBridge },
      { name: "zero-trust-lab-internal-sts", fn: props.zeroTrustLabFns.internalSts },
      { name: "zero-trust-lab-edge-authorizer", fn: props.zeroTrustLabFns.edgeAuthorizer },
      { name: "zero-trust-lab-edge-proxy", fn: props.zeroTrustLabFns.edgeProxy },
      { name: "zero-trust-lab-domain-a", fn: props.zeroTrustLabFns.domainA },
    ];

    const { schedules, role } = createWarmupSchedules(this, targets, SCHEDULE_NAME_PREFIX);

    const configFn = new lambda.Function(this, "WarmupConfigFunction", {
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
