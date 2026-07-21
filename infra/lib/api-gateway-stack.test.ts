import { describe, it } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
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
      alertsSettingsFnName: "alerts-settings",
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
    // Portfolio, Pantry, Imposter, WarmSchedule, Supergraph, AlertsSettings -
    // one Resource (path segment) each.
    template.resourceCountIs("AWS::ApiGateway::Resource", 6);
    // Each of the 6 resources gets GET + POST + an auto CORS-preflight
    // OPTIONS (from defaultCorsPreflightOptions), plus the root resource
    // gets its own auto OPTIONS too: 6 * 3 + 1.
    template.resourceCountIs("AWS::ApiGateway::Method", 19);
    template.hasResourceProperties("AWS::ApiGateway::DomainName", {
      DomainName: "api.example.com",
    });
    // The whole point of RestApi over the cheaper HttpApi it replaced - see
    // the stack's doc comment for why HttpApi couldn't propagate a trace
    // into the Lambda it routed to.
    template.hasResourceProperties("AWS::ApiGateway::Stage", {
      TracingEnabled: true,
    });
    // Asserts the cross-stack singleton collision (this stack + its
    // on-demand test-env twin, same account/region) never has a chance to
    // reappear - see the stack's cloudWatchRole comment.
    template.resourceCountIs("AWS::ApiGateway::Account", 0);
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
  });
});
