import { describe, it, vi, beforeAll, afterAll, type MockInstance } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SupergraphStack } from "./supergraph-stack";

// SupergraphGatewayFunction points lambda.Code.fromAsset at
// api/src/supergraph/dist, a build output that doesn't exist in this
// checkout - see pc-config-stack.test.ts's identical comment for why this
// needs stubbing.
let fromAssetSpy: MockInstance<typeof lambda.Code.fromAsset>;

beforeAll(() => {
  fromAssetSpy = vi
    .spyOn(lambda.Code, "fromAsset")
    .mockImplementation(
      () => lambda.Code.fromInline("exports.handler = async () => {};") as unknown as lambda.AssetCode
    );
});

afterAll(() => {
  fromAssetSpy.mockRestore();
});

describe("SupergraphStack", () => {
  it("synthesizes with the gateway Lambda and its live alias", () => {
    const app = new App();
    const stack = new SupergraphStack(app, "TestSupergraphStack", {
      functionName: "supergraph-graphql-test",
      apiBaseUrl: "https://api.test.petertran.au",
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "supergraph-graphql-test",
      Environment: {
        Variables: {
          API_BASE_URL: "https://api.test.petertran.au",
        },
      },
    });
    template.resourceCountIs("AWS::Lambda::Alias", 1);
    template.hasResourceProperties("AWS::Lambda::Alias", {
      Name: "live",
    });
  });
});
