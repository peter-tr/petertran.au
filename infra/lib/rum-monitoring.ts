import { Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as rum from "aws-cdk-lib/aws-rum";

export interface RumMonitoringProps {
  domainNames: string[];
}

export interface RumMonitoringResult {
  appMonitor: rum.CfnAppMonitor;
  identityPool: cognito.CfnIdentityPool;
}

// CloudWatch RUM (pageviews, client-side errors, performance) plus the guest
// (unauthenticated) Cognito identity pool RUM's web client uses to sign
// PutRumEvents from the browser - split out of SiteStack because "how the
// site serves traffic" and "how the site's own telemetry authenticates" are
// separate concerns that happened to live in one constructor. Creates its
// constructs directly on `scope` (the calling stack), not a nested construct
// scope, so logical ids - and therefore already-deployed resource identity -
// are unaffected by this being in its own file.
export function createRumMonitoring(scope: Construct, props: RumMonitoringProps): RumMonitoringResult {
  const stack = Stack.of(scope);

  // There's no logged-in user on this site, so every visitor assumes the
  // same guest role, scoped to nothing but sending telemetry for this one
  // app monitor.
  const rumIdentityPool = new cognito.CfnIdentityPool(scope, "RumIdentityPool", {
    // Explicit, so it reads clearly in the Cognito console instead of
    // CloudFormation's auto-generated name.
    identityPoolName: "petertran_au_rum",
    allowUnauthenticatedIdentities: true,
  });

  // Name (not the generated AppMonitor id) is what the ARN is keyed on, so
  // it can be computed here and handed to the guest role's policy before the
  // app monitor resource below exists - avoids a circular dependency between
  // the two.
  const rumAppMonitorName = "petertran-au";
  const rumAppMonitorArn = `arn:aws:rum:${stack.region}:${stack.account}:appmonitor/${rumAppMonitorName}`;

  const rumGuestRole = new iam.Role(scope, "RumGuestRole", {
    // Explicit, so it reads clearly in the IAM console instead of
    // CloudFormation's auto-generated name.
    roleName: "rum-guest-role",
    assumedBy: new iam.FederatedPrincipal(
      "cognito-identity.amazonaws.com",
      {
        StringEquals: { "cognito-identity.amazonaws.com:aud": rumIdentityPool.ref },
        "ForAnyValue:StringLike": { "cognito-identity.amazonaws.com:amr": "unauthenticated" },
      },
      "sts:AssumeRoleWithWebIdentity"
    ),
  });
  rumGuestRole.addToPolicy(
    new iam.PolicyStatement({
      actions: ["rum:PutRumEvents"],
      resources: [rumAppMonitorArn],
    })
  );

  new cognito.CfnIdentityPoolRoleAttachment(scope, "RumIdentityPoolRoleAttachment", {
    identityPoolId: rumIdentityPool.ref,
    roles: { unauthenticated: rumGuestRole.roleArn },
  });

  const rumAppMonitor = new rum.CfnAppMonitor(scope, "RumAppMonitor", {
    name: rumAppMonitorName,
    domainList: props.domainNames,
    // Telemetry data itself is 30-day-retained inside RUM regardless; this
    // also mirrors it to CloudWatch Logs so it can be queried with Logs
    // Insights (or graphed on a dashboard) past that window, same as the
    // X-Ray traces the GraphQL Lambda writes.
    cwLogEnabled: true,
    appMonitorConfiguration: {
      identityPoolId: rumIdentityPool.ref,
      guestRoleArn: rumGuestRole.roleArn,
      allowCookies: true,
      // Traffic here is low enough that 100% sampling costs nothing
      // meaningful and gives a complete picture rather than an
      // extrapolated one.
      sessionSampleRate: 1,
      telemetries: ["errors", "performance", "http"],
    },
  });

  return { appMonitor: rumAppMonitor, identityPool: rumIdentityPool };
}
