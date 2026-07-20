import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const secretsManagerMock = mockClient(SecretsManagerClient);

const AnthropicConstructor = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    constructor(opts: unknown) {
      AnthropicConstructor(opts);
    }
  },
}));

describe("getAnthropicClient", () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  const originalSecretArn = process.env.ANTHROPIC_SECRET_ARN;

  beforeEach(() => {
    vi.resetModules();
    secretsManagerMock.reset();
    AnthropicConstructor.mockClear();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_SECRET_ARN;
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalApiKey;

    if (originalSecretArn === undefined) delete process.env.ANTHROPIC_SECRET_ARN;
    else process.env.ANTHROPIC_SECRET_ARN = originalSecretArn;
  });

  it("builds the client from ANTHROPIC_API_KEY directly when set, without touching Secrets Manager", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-direct-key";

    const { getAnthropicClient } = await import("./anthropic-client");

    await getAnthropicClient();

    expect(AnthropicConstructor).toHaveBeenCalledWith({ apiKey: "sk-direct-key" });
    expect(secretsManagerMock.calls()).toHaveLength(0);
  });

  it("fetches the key from Secrets Manager when ANTHROPIC_API_KEY is unset", async () => {
    process.env.ANTHROPIC_SECRET_ARN = "arn:aws:secretsmanager:us-east-1:123:secret:anthropic-key";
    secretsManagerMock.on(GetSecretValueCommand).resolves({ SecretString: "sk-from-secret" });

    const { getAnthropicClient } = await import("./anthropic-client");
    await getAnthropicClient();

    expect(AnthropicConstructor).toHaveBeenCalledWith({ apiKey: "sk-from-secret" });

    const calls = secretsManagerMock.commandCalls(GetSecretValueCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.SecretId).toBe("arn:aws:secretsmanager:us-east-1:123:secret:anthropic-key");
  });

  it("caches the client across calls - only constructs Anthropic once", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-direct-key";

    const { getAnthropicClient } = await import("./anthropic-client");

    const first = await getAnthropicClient();
    const second = await getAnthropicClient();

    expect(first).toBe(second);
    expect(AnthropicConstructor).toHaveBeenCalledTimes(1);
  });

  it("caches the client across calls - only fetches the secret once", async () => {
    process.env.ANTHROPIC_SECRET_ARN = "arn:aws:secretsmanager:us-east-1:123:secret:anthropic-key";
    secretsManagerMock.on(GetSecretValueCommand).resolves({ SecretString: "sk-from-secret" });

    const { getAnthropicClient } = await import("./anthropic-client");
    await getAnthropicClient();
    await getAnthropicClient();

    expect(secretsManagerMock.commandCalls(GetSecretValueCommand)).toHaveLength(1);
  });

  it("throws when neither ANTHROPIC_API_KEY nor ANTHROPIC_SECRET_ARN is configured", async () => {
    const { getAnthropicClient } = await import("./anthropic-client");

    await expect(getAnthropicClient()).rejects.toThrow(
      "Neither ANTHROPIC_API_KEY nor ANTHROPIC_SECRET_ARN is configured."
    );
  });

  it("throws when the resolved secret has no string value", async () => {
    process.env.ANTHROPIC_SECRET_ARN = "arn:aws:secretsmanager:us-east-1:123:secret:anthropic-key";
    secretsManagerMock.on(GetSecretValueCommand).resolves({});

    const { getAnthropicClient } = await import("./anthropic-client");

    await expect(getAnthropicClient()).rejects.toThrow("Anthropic API key secret has no string value.");
  });
});
