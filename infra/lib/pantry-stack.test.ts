import { describe, it, vi, beforeAll, afterAll, type MockInstance } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { PantryStack } from "./pantry-stack";

// PantryStack points lambda.Code.fromAsset at api/src/pantry/dist, a build
// output that doesn't exist in this checkout - see games-stack.test.ts's
// identical comment for why this needs stubbing.
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

describe("PantryStack", () => {
  it("synthesizes with the GraphQL/digest/price-check Lambdas and the pantry table", () => {
    const app = new App();
    const stack = new PantryStack(app, "TestPantryStack", {
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    // PantryGraphQLFunction, PantryDigestFunction, PantryPriceCheckFunction.
    template.resourceCountIs("AWS::Lambda::Function", 3);
    template.resourceCountIs("AWS::DynamoDB::Table", 1);
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "pantry",
      DeletionProtectionEnabled: true,
    });
    // Hourly digest + hourly-tick isn't here - PantryDigestSchedule is the
    // only scheduler:: Schedule this stack creates.
    template.resourceCountIs("AWS::Scheduler::Schedule", 1);
    template.resourceCountIs("AWS::Cognito::UserPool", 1);
    template.hasResourceProperties("AWS::Cognito::UserPool", { UserPoolName: "pantry-users" });
  });

  it("isTestEnv: skips the digest/price-check Lambdas and schedule, drops table protection", () => {
    const app = new App();
    const stack = new PantryStack(app, "TestEnvPantryStack", {
      tableName: "pantry-test",
      functionName: "pantry-graphql-test",
      isTestEnv: true,
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    // Just PantryGraphQLFunction - no digest/price-check Lambdas, neither
    // of which is part of what the test env exists to validate.
    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "pantry-graphql-test",
    });
    template.resourceCountIs("AWS::Scheduler::Schedule", 0);
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "pantry-test",
      DeletionProtectionEnabled: false,
    });
  });
});
