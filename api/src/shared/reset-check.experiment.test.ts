import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { mockClient } from "aws-sdk-client-mock";
import { describe, expect, it, vi } from "vitest";

const secretsManagerMock = mockClient(SecretsManagerClient);

describe("resetModules + aws-sdk-client-mock interaction", () => {
  it("works after resetModules + dynamic re-import", async () => {
    secretsManagerMock.on(GetSecretValueCommand).resolves({ SecretString: "abc" });
    vi.resetModules();
    const mod = await import("@aws-sdk/client-secrets-manager");
    const client = new mod.SecretsManagerClient({});
    const res = await client.send(new mod.GetSecretValueCommand({ SecretId: "x" }));
    console.log("RESULT:", JSON.stringify(res));
    expect(res.SecretString).toBe("abc");
  });
});
