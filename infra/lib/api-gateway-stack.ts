import { Stack, StackProps, CfnOutput, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import { LIVE_ALIAS_NAME, liveAliasArn } from "./shared/function-names";

export interface ApiGatewayStackProps extends StackProps {
  domainName: string;
  alternateDomainNames?: string[];
  hostedZoneId: string;
  hostedZoneName: string;
  // Subdomain this stack's RestApi lives under - defaults to "api"
  // (api.petertran.au). The on-demand test environment (see
  // infra/bin/app.ts) passes "api.test" instead, so both invocations can
  // deploy into the same hosted zone without colliding.
  apiSubdomain?: string;
  // Plain function *names* (not live lambda.IFunction references) - same
  // reasoning as ProvisionedConcurrencyStack (see its doc comment): a live reference passed
  // cross-stack becomes a CloudFormation export that blocks the producing
  // stack from ever replacing that Lambda for as long as this stack has it
  // imported.
  portfolioFnName: string;
  pantryFnName: string;
  imposterFnName: string;
  // Omitted (not just empty-string) for the test env - PC is an
  // operational concern that doesn't apply to a disposable environment (see
  // warm-schedule-stack.ts), so its route is skipped entirely rather than
  // pointed at a Lambda that doesn't exist there.
  warmScheduleFnName?: string;
  // Passed by both the prod and test-env instantiations (see
  // infra/bin/app.ts) - kept optional rather than required, same as
  // warmScheduleFnName above, so a future caller can still omit it.
  supergraphFnName?: string;
  // Optional (unlike portfolio/pantry/imposter) - design-studio doesn't
  // participate in the on-demand test env yet, so this is only ever passed
  // by the prod instantiation.
  designStudioFnName?: string;
  // Omitted for the test env, same reasoning as warmScheduleFnName above -
  // muting alert emails isn't something the test env needs to validate, and
  // it has no MonitoringStack counterpart to point at anyway.
  alertsSettingsFnName?: string;
}

/**
 * Single shared RestApi in front of portfolio/pantry/imposter/supergraph/
 * warm-schedule, replacing their individual Lambda Function URLs with one
 * stable, human-readable domain (api.petertran.au) - so
 * web/.env.production never needs to track a CloudFormation-generated URL
 * again. Deliberately does NOT cover zero-trust-lab's own edge/domain
 * gateways - those stay isolated per that stack's own design intent (see
 * zero-trust-lab-stack.ts).
 *
 * REST API (aws-apigateway), not HTTP API (aws-apigatewayv2, what this
 * replaced) - HTTP API has no X-Ray active-tracing option at all (confirmed
 * by grepping aws-cdk-lib for a tracing prop on HttpApi/CfnStage - there
 * isn't one), so an X-Amzn-Trace-Id header set on an outbound request
 * reaches the invoked Lambda's `event.headers` but is never promoted into
 * its actual X-Ray trace context. Verified live: supergraph's subgraph
 * calls and portfolio/pantry/imposter's own invocations kept showing up as
 * separate, disconnected traces even after supergraph/handler.ts started
 * sending that header. REST API's `deployOptions.tracingEnabled` is the
 * AWS-native mechanism for this - see its doc comment below.
 *
 * Reused as-is for the on-demand test environment (see infra/bin/app.ts),
 * fronting portfolio/pantry/imposter/supergraph under api.test.petertran.au -
 * warmScheduleFnName omitted, apiSubdomain overridden.
 */
export class ApiGatewayStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiGatewayStackProps) {
    super(scope, id, props);

    const hostedZone = route53.PublicHostedZone.fromPublicHostedZoneAttributes(this, "PetertranHostedZone", {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.hostedZoneName,
    });

    const apiDomain = `${props.apiSubdomain ?? "api"}.${props.hostedZoneName}`;

    // Unlike CertStack's cert (validated manually - no zone passed to
    // fromDns), this one imports the zone directly, so CDK auto-manages the
    // validation CNAME with no manual step.
    const apiCertificate = new acm.Certificate(this, "ApiCertificate", {
      domainName: apiDomain,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    const restApi = new apigateway.RestApi(this, "ApiGateway", {
      domainName: {
        domainName: apiDomain,
        certificate: apiCertificate,
        endpointType: apigateway.EndpointType.REGIONAL,
      },
      endpointConfiguration: { types: [apigateway.EndpointType.REGIONAL] },
      deployOptions: {
        // The whole reason this stack is a RestApi and not the cheaper
        // HttpApi - lets X-Ray follow a request from this gateway into
        // whichever Lambda it routes to, so supergraph's fan-out to
        // portfolio/pantry/imposter shows up as one connected trace instead
        // of each hop starting a fresh, disconnected one. See the class doc
        // comment above.
        tracingEnabled: true,
      },
      // Both this stack and its on-demand test-environment twin
      // (PetertranTestApiGatewayStack) deploy into the same account/region -
      // the CloudWatch role RestApi creates by default is an
      // account-level singleton (AWS::ApiGateway::Account), so a second
      // stack trying to create its own would collide with the first.
      // Neither stack turns on execution/access logging (only
      // deployOptions.tracingEnabled above, which uses a separate,
      // AWS-managed X-Ray permission, not this role), so there's nothing
      // lost by disabling it on both.
      cloudWatchRole: false,
      defaultCorsPreflightOptions: {
        allowOrigins: [
          `https://${props.domainName}`,
          ...(props.alternateDomainNames ?? []).map((d) => `https://${d}`),
          "http://localhost:5173",
          "http://localhost:3000",
        ],
        allowMethods: ["GET", "POST"],
        allowHeaders: ["content-type", "apollo-require-preflight"],
        maxAge: Duration.hours(1),
      },
    });

    // Exact-path resources, not `{proxy+}` - portfolio/pantry/imposter/
    // supergraph/warm-schedule are each single-endpoint Apollo/JSON
    // services, never called with a sub-path (see
    // web/src/shared/graphqlClient.ts and useWarmSchedule.ts).
    //
    // portfolio/pantry/imposter/supergraph carry `aliasName: LIVE_ALIAS_NAME`
    // so real traffic actually lands on the qualifier ProvisionedConcurrencyStack
    // applies Provisioned Concurrency to - see warm-schedule-stack.ts's doc
    // comment. (Supergraph itself has no PC schedule yet, but still
    // publishes the alias so it's consistent with the other three and ready
    // for one later.) warm-schedule has no alias, bare $LATEST, unaffected.
    const routes: { id: string; path: string; functionName: string; aliasName?: string }[] = [
      {
        id: "Portfolio",
        path: "portfolio",
        functionName: props.portfolioFnName,
        aliasName: LIVE_ALIAS_NAME,
      },
      { id: "Pantry", path: "pantry", functionName: props.pantryFnName, aliasName: LIVE_ALIAS_NAME },
      { id: "Imposter", path: "imposter", functionName: props.imposterFnName, aliasName: LIVE_ALIAS_NAME },
      ...(props.warmScheduleFnName
        ? [{ id: "WarmSchedule", path: "warm-schedule", functionName: props.warmScheduleFnName }]
        : []),
      ...(props.alertsSettingsFnName
        ? [{ id: "AlertsSettings", path: "alerts-settings", functionName: props.alertsSettingsFnName }]
        : []),
      ...(props.supergraphFnName
        ? [
            {
              id: "Supergraph",
              path: "graphql",
              functionName: props.supergraphFnName,
              aliasName: LIVE_ALIAS_NAME,
            },
          ]
        : []),
      // This route exists only for the supergraph gateway's own
      // IntrospectAndCompose to reach this subgraph - the browser always
      // talks to /graphql (the composed schema) above, never straight to
      // /design-studio (see web/.env.production's comment).
      ...(props.designStudioFnName
        ? [
            {
              id: "DesignStudio",
              path: "design-studio",
              functionName: props.designStudioFnName,
              aliasName: LIVE_ALIAS_NAME,
            },
          ]
        : []),
    ];

    for (const route of routes) {
      const targetFn = route.aliasName
        ? lambda.Function.fromFunctionAttributes(this, `${route.id}Alias`, {
            functionArn: liveAliasArn(this.region, this.account, route.functionName),
            sameEnvironment: true,
          })
        : lambda.Function.fromFunctionName(this, `${route.id}Fn`, route.functionName);
      const integration = new apigateway.LambdaIntegration(targetFn);
      const resource = restApi.root.addResource(route.path);
      // GET/POST, not ANY - ANY also matches OPTIONS, which would route the
      // browser's CORS preflight request to the Lambda instead of letting
      // defaultCorsPreflightOptions's auto-added mock integration answer it.
      // Apollo's CSRF-prevention plugin then rejects that bare OPTIONS
      // request with a 400, which browsers treat as a failed preflight -
      // blocking every real request with a CORS error.
      resource.addMethod("GET", integration);
      resource.addMethod("POST", integration);
    }

    const aliasTarget = route53.RecordTarget.fromAlias(
      new route53Targets.ApiGatewayDomain(restApi.domainName!)
    );
    new route53.ARecord(this, "ApiAliasRecordV4", {
      zone: hostedZone,
      recordName: props.apiSubdomain ?? "api",
      target: aliasTarget,
    });
    new route53.AaaaRecord(this, "ApiAliasRecordV6", {
      zone: hostedZone,
      recordName: props.apiSubdomain ?? "api",
      target: aliasTarget,
    });

    new CfnOutput(this, "ApiBaseUrl", { value: `https://${apiDomain}` });
  }
}
