import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AnthropicBedrockConstructor = vi.fn();

vi.mock("@anthropic-ai/bedrock-sdk", () => ({
  AnthropicBedrock: class MockAnthropicBedrock {
    constructor(opts: unknown) {
      AnthropicBedrockConstructor(opts);
    }
  },
}));

describe("getAnthropicBedrockClient", () => {
  const originalRegion = process.env.AWS_REGION;

  beforeEach(() => {
    vi.resetModules();
    AnthropicBedrockConstructor.mockClear();
    delete process.env.AWS_REGION;
  });

  afterEach(() => {
    if (originalRegion === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = originalRegion;
  });

  it("builds the client from AWS_REGION when set", async () => {
    process.env.AWS_REGION = "us-west-2";

    const { getAnthropicBedrockClient } = await import("./anthropic-bedrock-client");
    getAnthropicBedrockClient();

    expect(AnthropicBedrockConstructor).toHaveBeenCalledWith({ awsRegion: "us-west-2" });
  });

  it("falls back to ap-southeast-2 (where every Lambda in this repo deploys) when AWS_REGION is unset", async () => {
    const { getAnthropicBedrockClient } = await import("./anthropic-bedrock-client");
    getAnthropicBedrockClient();

    expect(AnthropicBedrockConstructor).toHaveBeenCalledWith({ awsRegion: "ap-southeast-2" });
  });

  it("caches the client across calls - only constructs AnthropicBedrock once", async () => {
    process.env.AWS_REGION = "us-east-1";

    const { getAnthropicBedrockClient } = await import("./anthropic-bedrock-client");

    const first = getAnthropicBedrockClient();
    const second = getAnthropicBedrockClient();

    expect(first).toBe(second);
    expect(AnthropicBedrockConstructor).toHaveBeenCalledTimes(1);
  });
});
