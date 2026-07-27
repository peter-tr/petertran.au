import { describe, it } from "vitest";
import { App } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { ApiGatewayStack } from "./api-gateway-stack";

describe("ApiGatewayStack", () => {
  it("synthesizes with the shared RestApi and a resource per target Lambda, tracing enabled", () => {
    const app = new App();
    const stack = new ApiGatewayStack(app, "TestApiGatewayStack", {
      domainName: "www.example.com",
      alternateDomainNames: ["example.com"],
      hostedZoneId: "Z0000000000000EXAMPLE",
      hostedZoneName: "example.com",
      portfolioFnName: "portfolio-graphql",
      pantryFnName: "pantry-graphql",
      imposterFnName: "imposter-graphql",
      warmScheduleFnName: "warm-schedule",
      supergraphFnName: "supergraph-graphql",
      designStudioFnName: "design-studio-graphql",
      alertsSettingsFnName: "alerts-settings",
      enableWafRateLimit: true,
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
    // Portfolio, Pantry, Imposter, WarmSchedule, Supergraph, AlertsSettings,
    // DesignStudio - one Resource (path segment) each.
    template.resourceCountIs("AWS::ApiGateway::Resource", 7);
    // Each of the 7 resources gets GET + POST + an auto CORS-preflight
    // OPTIONS (from defaultCorsPreflightOptions), plus the root resource
    // gets its own auto OPTIONS too: 7 * 3 + 1.
    template.resourceCountIs("AWS::ApiGateway::Method", 22);
    template.hasResourceProperties("AWS::ApiGateway::DomainName", {
      DomainName: "api.example.com",
    });
    // The whole point of RestApi over the cheaper HttpApi it replaced - see
    // the stack's doc comment for why HttpApi couldn't propagate a trace
    // into the Lambda it routed to.
    template.hasResourceProperties("AWS::ApiGateway::Stage", {
      TracingEnabled: true,
    });
    // Without "authorization" here, the browser's CORS preflight blocks
    // pantry's signed-in requests before they ever reach a Lambda - see
    // web/src/pantry/lib/auth.ts.
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "OPTIONS",
      Integration: {
        IntegrationResponses: [
          {
            ResponseParameters: Match.objectLike({
              "method.response.header.Access-Control-Allow-Headers":
                "'content-type,apollo-require-preflight,x-amzn-trace-id,authorization,apollographql-client-name,apollo-federation-include-trace'",
              // Regression test: this origin was missing from allowOrigins
              // entirely (confirmed live 2026-07-27) - CDK's mock preflight
              // integration falls back to echoing the *first* configured
              // origin for any request whose Origin isn't in the list at
              // all, so both the embedded Sandbox UI and Apollo Studio's
              // own Explorer failed CORS preflight this whole time.
              "method.response.header.Access-Control-Allow-Credentials": "'true'",
            }),
            // CDK renders per-origin matching as a Velocity Template that
            // overrides the response's Allow-Origin header at request time
            // if the real Origin matches one of the non-default entries -
            // this is what actually lets studio.apollographql.com's
            // preflight succeed, not the static header above (which is
            // just the first-listed origin as a fallback default).
            ResponseTemplates: Match.objectLike({
              "application/json": Match.stringLikeRegexp("https://studio\\.apollographql\\.com"),
            }),
          },
        ],
      },
    });
    // Asserts the cross-stack singleton collision (this stack + its
    // on-demand test-env twin, same account/region) never has a chance to
    // reappear - see the stack's cloudWatchRole comment.
    template.resourceCountIs("AWS::ApiGateway::Account", 0);
    // Coarse per-IP outer defense layer, starting in COUNT (not BLOCK) -
    // see the stack's doc comment above the WebACL for why.
    template.resourceCountIs("AWS::WAFv2::WebACL", 1);
    template.hasResourceProperties("AWS::WAFv2::WebACL", {
      Scope: "REGIONAL",
      DefaultAction: { Allow: {} },
      Rules: [
        {
          Name: "RateLimitByIp",
          Action: { Count: {} },
          Statement: {
            RateBasedStatement: {
              Limit: 100,
              AggregateKeyType: "IP",
              EvaluationWindowSec: 60,
            },
          },
        },
      ],
    });
    template.resourceCountIs("AWS::WAFv2::WebACLAssociation", 1);
  });

  it("isTestEnv: routes portfolio/pantry/imposter/supergraph (no warm-schedule), under the given apiSubdomain", () => {
    const app = new App();
    const stack = new ApiGatewayStack(app, "TestEnvApiGatewayStack", {
      domainName: "test.example.com",
      alternateDomainNames: ["www.test.example.com"],
      hostedZoneId: "Z0000000000000EXAMPLE",
      hostedZoneName: "example.com",
      apiSubdomain: "api.test",
      portfolioFnName: "portfolio-graphql-test",
      pantryFnName: "pantry-graphql-test",
      imposterFnName: "imposter-graphql-test",
      supergraphFnName: "supergraph-graphql-test",
      // warmScheduleFnName omitted - not part of what the test env exists to
      // validate.
      // Matches infra/bin/app.ts's real wiring - the on-demand test env
      // doesn't get its own WebACL charge on top of prod's.
      enableWafRateLimit: false,
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    // Portfolio, Pantry, Imposter, Supergraph - WarmSchedule resource
    // skipped. 4 resources * (GET+POST+OPTIONS) + root's own OPTIONS.
    template.resourceCountIs("AWS::ApiGateway::Resource", 4);
    template.resourceCountIs("AWS::ApiGateway::Method", 13);
    template.hasResourceProperties("AWS::ApiGateway::DomainName", {
      DomainName: "api.test.example.com",
    });
    template.resourceCountIs("AWS::WAFv2::WebACL", 0);
    template.resourceCountIs("AWS::WAFv2::WebACLAssociation", 0);
  });
});
