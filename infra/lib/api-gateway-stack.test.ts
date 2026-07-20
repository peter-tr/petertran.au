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
      warmupConfigFnName: "warmup-config",
      pcConfigFnName: "pc-config",
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    // Portfolio, Pantry, Imposter, Warmup, PcConfig - each registered for
    // both GET and POST, which CDK emits as 2 separate Route resources.
    template.resourceCountIs("AWS::ApiGatewayV2::Route", 10);
    template.hasResourceProperties("AWS::ApiGatewayV2::DomainName", {
      DomainName: "api.example.com",
    });
  });
});
