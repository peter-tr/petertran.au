import { Stack, StackProps, CfnOutput, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
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
  // Cost/on-off switch for the WAF rate-based rule below - a WebACL has its
  // own flat monthly charge regardless of how it's configured, so the only
  // way to actually stop paying for it is to not provision it at all (a
  // COUNT-vs-BLOCK toggle on the rule wouldn't do that). Required, not
  // optional-with-a-default, so every call site has to say explicitly
  // whether it wants this - see infra/bin/app.ts's ENABLE_WAF_RATE_LIMIT.
  enableWafRateLimit: boolean;
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
 * separate, disconnected traces even after the supergraph gateway started
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
          // Apollo's embedded Sandbox UI (router.yaml's sandbox.enabled)
          // and Apollo Studio's own hosted Explorer both run from this
          // origin - missing here entirely (confirmed live 2026-07-27),
          // this mock preflight integration falls back to echoing the
          // *first* origin in this list instead of matching the request's
          // real Origin, so every cross-origin request from either of
          // those actually failed preflight this whole time. router.yaml's
          // own cors.origins (a separate config - see its comment) already
          // had this added back when sandbox.enabled first shipped, but
          // that only covers Router's response to the actual POST, not
          // this preflight, which never reached Router at all.
          "https://studio.apollographql.com",
        ],
        // Studio's Explorer (not the embedded Sandbox) sends requests with
        // credentials included so its "Include cookies" toggle can work -
        // the browser requires this on the response regardless of whether
        // the origin already matches, confirmed live via Studio's own
        // Explorer. See router.yaml's identical allow_credentials comment
        // for why this doesn't change behavior for our own frontend
        // traffic (nothing here uses cookies for auth).
        allowCredentials: true,
        allowMethods: ["GET", "POST"],
        // x-amzn-trace-id: RUM's fetch instrumentation attaches this header
        // when enableXRay is on (see web/src/shared/rum.ts) to link a
        // recorded session to the backend X-Ray trace it caused - without it
        // in the allowlist, the browser's preflight would reject every
        // GraphQL call outright. authorization: pantry's signed-in requests
        // carry a Cognito ID token here (see web/src/pantry/lib/auth.ts) -
        // same reasoning, the preflight blocks it client-side before it ever
        // reaches a Lambda without this. apollographql-client-name:
        // graphqlClient.ts sends this on every request (see PR #205) so
        // GraphOS Studio can attribute traffic to a named client - missed
        // updating this allowlist when that shipped, which silently broke
        // every real browser request with a generic "Failed to fetch"
        // (confirmed live 2026-07-27: curl without this header succeeded
        // fine since it never triggers a preflight, masking the bug from
        // every manual verification during that PR). apollo-federation-
        // include-trace: Studio's hosted Explorer sends this automatically
        // on every request to a federated graph, to request per-field trace
        // data (ftv1) for its response inspector - same "curl never
        // triggers a preflight" blind spot as apollographql-client-name
        // above, only surfaced by testing in a real browser (confirmed live
        // 2026-07-27: "Request header field apollo-federation-include-trace
        // is not allowed by Access-Control-Allow-Headers in preflight
        // response").
        allowHeaders: [
          "content-type",
          "apollo-require-preflight",
          "x-amzn-trace-id",
          "authorization",
          "apollographql-client-name",
          "apollo-federation-include-trace",
        ],
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

    // Coarse, per-IP outer defense layer, on top of (not instead of) each
    // project's own app-level DynamoDB rate limiter (see
    // api/src/shared/rate-limit.ts) - that limiter is fine-grained
    // (different limits per operation cost) but only rejects a request
    // after it's already paid for a full Lambda invocation and a DynamoDB
    // write. A WAF rate-based rule rejects at the edge, before either of
    // those happen, but can't see GraphQL operation names to differentiate
    // cost - hence "in addition to", not "replacing".
    //
    // Gated on enableWafRateLimit (see its doc comment above) - a WebACL
    // bills a flat monthly charge just for existing, so this is an `if`
    // around the whole resource, not a per-rule toggle.
    if (props.enableWafRateLimit) {
      // No explicit `name` here (same as RestApi above) - this stack
      // deploys twice (prod and the on-demand test env, see
      // infra/bin/app.ts), and a hardcoded literal name would collide
      // between the two in the same account/region. CloudFormation's
      // auto-generated physical name already incorporates the stack name,
      // so the two stay distinct without one.
      //
      // Starts in COUNT (not BLOCK) - deliberately observational for now.
      // Flip the rule's `action` to `{ block: {} }` in a follow-up change
      // once the CountedRequests CloudWatch metric (dimensioned by this
      // WebACL's Rule name below) shows what real traffic actually looks
      // like, so the 100/min threshold can be validated (or adjusted)
      // before it can ever reject a real visitor.
      const rateLimitWebAcl = new wafv2.CfnWebACL(this, "ApiRateLimitWebAcl", {
        scope: "REGIONAL",
        defaultAction: { allow: {} },
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: "ApiRateLimitWebAcl",
        },
        rules: [
          {
            name: "RateLimitByIp",
            priority: 0,
            action: { count: {} },
            statement: {
              rateBasedStatement: {
                // Requests per IP per evaluationWindowSec before this rule
                // counts (not yet blocks) a client - starting point for
                // COUNT mode's observation window, not a validated number
                // yet. All routes behind this one shared RestApi share this
                // ceiling (portfolio/pantry/imposter/supergraph/
                // design-studio), so it's sized well above what a single
                // legitimate visitor bouncing between them in a minute
                // would ever hit.
                limit: 100,
                aggregateKeyType: "IP",
                // Shortest window WAF supports (60/120/300/600 are the
                // only valid values) - closest match to the app-level
                // limiters' own 1-minute buckets (see
                // api/src/shared/rate-limit.ts).
                evaluationWindowSec: 60,
              },
            },
            visibilityConfig: {
              sampledRequestsEnabled: true,
              cloudWatchMetricsEnabled: true,
              metricName: "RateLimitByIp",
            },
          },
        ],
      });

      new wafv2.CfnWebACLAssociation(this, "ApiRateLimitWebAclAssociation", {
        resourceArn: restApi.deploymentStage.stageArn,
        webAclArn: rateLimitWebAcl.attrArn,
      });
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
