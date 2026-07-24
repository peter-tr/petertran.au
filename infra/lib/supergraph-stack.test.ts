import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, vi, beforeAll, afterAll, type MockInstance } from "vitest";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SupergraphStack } from "./supergraph-stack";

// SupergraphGatewayFunction points lambda.Code.fromAsset at
// api/src/supergraph/dist, a build output that doesn't exist in this
// checkout - see pc-config-stack.test.ts's identical comment for why this
// needs stubbing. fromInline is rejected by CDK for provided.al2023 (a
// custom runtime needs a real bootstrap executable, not an inline code
// string), so this points the real fromAsset at a throwaway directory with
// a real (empty) bootstrap file instead of faking the Code object itself.
let fromAssetSpy: MockInstance<typeof lambda.Code.fromAsset>;
let fixtureDir: string;

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), "supergraph-stack-test-"));
  writeFileSync(join(fixtureDir, "bootstrap"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  const realFromAsset = lambda.Code.fromAsset.bind(lambda.Code);
  fromAssetSpy = vi.spyOn(lambda.Code, "fromAsset").mockImplementation(() => realFromAsset(fixtureDir));
});

afterAll(() => {
  fromAssetSpy.mockRestore();
  rmSync(fixtureDir, { recursive: true, force: true });
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
      Runtime: "provided.al2023",
      Handler: "bootstrap",
      Architectures: ["x86_64"],
      Environment: {
        Variables: {
          API_BASE_URL: "https://api.test.petertran.au",
          AWS_LWA_PORT: "8080",
        },
      },
      Layers: [
        "arn:aws:lambda:ap-southeast-2:753240598075:layer:LambdaAdapterLayerX86:28",
        "arn:aws:lambda:ap-southeast-2:901920570463:layer:aws-otel-collector-amd64-ver-0-117-0:1",
      ],
    });
    template.resourceCountIs("AWS::Lambda::Alias", 1);
    template.hasResourceProperties("AWS::Lambda::Alias", {
      Name: "live",
    });
  });
});
