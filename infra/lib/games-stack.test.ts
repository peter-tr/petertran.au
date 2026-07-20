import { describe, it, vi, beforeAll, afterAll } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { GamesStack } from "./games-stack";

// GamesStack points lambda.Code.fromAsset at api/src/games/imposter/dist, a
// build output that doesn't exist in this checkout (nothing has run `npm run
// build` for that package here) - CDK's AssetCode throws synchronously at
// Function-construction time if the path is missing. Stub fromAsset with
// inline code so the stack can synthesize without a real build artifact.
let fromAssetSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  fromAssetSpy = vi
    .spyOn(lambda.Code, "fromAsset")
    .mockImplementation(() => lambda.Code.fromInline("exports.handler = async () => {};"));
});

afterAll(() => {
  fromAssetSpy.mockRestore();
});

describe("GamesStack", () => {
  it("synthesizes with the imposter Lambda and its DynamoDB table", () => {
    const app = new App();
    const stack = new GamesStack(app, "TestGamesStack", {
      env: { account: "123456789012", region: "ap-southeast-2" },
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::Lambda::Function", 1);
    template.resourceCountIs("AWS::DynamoDB::Table", 1);
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "games",
    });
    template.hasResourceProperties("AWS::Lambda::Alias", {
      Name: "live",
    });
  });
});
