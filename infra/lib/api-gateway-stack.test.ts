import { describe, it } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { ApiGatewayStack } from "./api-gateway-stack";

describe("ApiGatewayStack", () => {
  it("synthesizes with the shared HttpApi and a route per target Lambda", () => {
    const app = new App();
    const stack = new ApiGatewayStack(app, "TestApiGatewayStack", {
      domainName: "www.example.com",
      alternateDomainNames: ["example.com"],
      hostedZoneId: "Z0000000000000EXAMPLE",
      hostedZoneName: "example.com",
      portfolioFnName: "portfolio-graphql",
      pantryFnName: "pantry-graphql",
      imposterFnName: "imposter-graphql",
      pcConfigFnName: "pc-config",
      supergraphFnName: "supergraph-graphql",
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    // Portfolio, Pantry, Imposter, PcConfig, Supergraph - each registered
    // for both GET and POST, which CDK emits as 2 separate Route resources.
    template.resourceCountIs("AWS::ApiGatewayV2::Route", 10);
    template.hasResourceProperties("AWS::ApiGatewayV2::DomainName", {
      DomainName: "api.example.com",
    });
  });

  it("isTestEnv: routes portfolio/pantry/imposter/supergraph (no pc-config), under the given apiSubdomain", () => {
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
      // pcConfigFnName omitted - not part of what the test env exists to
      // validate.
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    // Portfolio, Pantry, Imposter, Supergraph - PcConfig route skipped.
    template.resourceCountIs("AWS::ApiGatewayV2::Route", 8);
    template.hasResourceProperties("AWS::ApiGatewayV2::DomainName", {
      DomainName: "api.test.example.com",
    });
  });
});
