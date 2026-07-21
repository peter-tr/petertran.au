import { describe, it, vi, beforeAll, afterAll, type MockInstance } from "vitest";
import { App } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { DesignStudioStack } from "./design-studio-stack";

// DesignStudioStack points lambda.Code.fromAsset at api/src/design-studio/dist,
// a build output that may not exist in this checkout - CDK's AssetCode throws
// synchronously at Function-construction time if the path is missing. Stub
// fromAsset with inline code so the stack can synthesize without a real
// build artifact, same as games-stack.test.ts.
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

describe("DesignStudioStack", () => {
  it("synthesizes with the Lambda, no DynamoDB table, and the Mongo secret granted", () => {
    const app = new App();
    const stack = new DesignStudioStack(app, "TestDesignStudioStack", {
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.resourceCountIs("AWS::DynamoDB::Table", 0);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "design-studio-graphql",
      Environment: {
        Variables: {
          MONGO_SECRET_ARN: Match.anyValue(),
        },
      },
    });
    template.hasResourceProperties("AWS::Lambda::Alias", {
      Name: "live",
    });
    // grantRead(designStudioFn) - confirms the Lambda's role can actually
    // read the Mongo connection string secret, not just that an env var
    // pointing at its ARN exists.
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: Match.arrayWith(["secretsmanager:GetSecretValue"]) }),
        ]),
      },
    });
  });

  it("accepts an override functionName for the on-demand test env", () => {
    const app = new App();
    const stack = new DesignStudioStack(app, "TestEnvDesignStudioStack", {
      functionName: "design-studio-graphql-test",
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "design-studio-graphql-test",
    });
  });
});
