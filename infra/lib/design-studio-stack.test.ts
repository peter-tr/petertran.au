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
  it("synthesizes with the Lambda, no DynamoDB table, and the Mongo URI resolved at deploy time", () => {
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
          // A CloudFormation dynamic reference (`{{resolve:secretsmanager:...}}`)
          // resolved at deploy time, not a runtime-fetched ARN - see
          // design-studio-stack.ts's doc comment on why. Match.anyValue() only
          // confirms the key is present; the exact Fn::Join token shape isn't
          // worth pinning in a test.
          MONGO_URI: Match.anyValue(),
        },
      },
    });
    template.hasResourceProperties("AWS::Lambda::Alias", {
      Name: "live",
    });
    // anthropicSecret.grantRead(designStudioFn) - the Mongo secret is no
    // longer read at runtime (see MONGO_URI above), so this policy now only
    // covers the Anthropic API key used by the AI design-generation mutation.
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
