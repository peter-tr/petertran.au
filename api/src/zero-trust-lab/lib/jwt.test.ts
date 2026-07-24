import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { KMSClient, SignCommand, GetPublicKeyCommand } from "@aws-sdk/client-kms";
import { generateKeyPairSync } from "crypto";
import { signJwt, getJwks, type JwtClaims } from "./jwt";

const kmsMock = mockClient(KMSClient);

beforeEach(() => {
  kmsMock.reset();
});

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("signJwt", () => {
  const claims: JwtClaims = { sub: "user-1", aud: "domain-a", iss: "https://issuer.example.com/" };

  it("builds a three-part JWS with the expected header and payload", async () => {
    kmsMock.on(SignCommand).resolves({ Signature: new Uint8Array([1, 2, 3, 4]) });

    const jwt = await signJwt(claims, "key-id", "kid-1", 120);
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);

    expect(decodeSegment(parts[0])).toEqual({ alg: "RS256", typ: "JWT", kid: "kid-1" });

    const payload = decodeSegment(parts[1]);
    expect(payload.sub).toBe("user-1");
    expect(payload.aud).toBe("domain-a");
    expect(payload.iss).toBe("https://issuer.example.com/");
    expect((payload.exp as number) - (payload.iat as number)).toBe(120);
  });

  it("base64url-encodes the raw KMS signature bytes as the third segment", async () => {
    kmsMock.on(SignCommand).resolves({ Signature: new Uint8Array([1, 2, 3, 4]) });

    const jwt = await signJwt(claims, "key-id", "kid-1");
    const signatureBytes = Buffer.from(jwt.split(".")[2], "base64url");
    expect(signatureBytes).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it("defaults the ttl to 120 seconds when not provided", async () => {
    kmsMock.on(SignCommand).resolves({ Signature: new Uint8Array([9]) });

    const jwt = await signJwt(claims, "key-id", "kid-1");
    const payload = decodeSegment(jwt.split(".")[1]);
    expect((payload.exp as number) - (payload.iat as number)).toBe(120);
  });

  it("signs with the given KMS key id and the RSASSA_PKCS1_V1_5_SHA_256 algorithm", async () => {
    kmsMock.on(SignCommand).resolves({ Signature: new Uint8Array([1]) });

    await signJwt(claims, "my-key-id", "kid-1");

    const calls = kmsMock.commandCalls(SignCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toMatchObject({
      KeyId: "my-key-id",
      SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256",
      MessageType: "RAW",
    });
  });

  it("throws when KMS returns no signature", async () => {
    kmsMock.on(SignCommand).resolves({});

    await expect(signJwt(claims, "key-id", "kid-1")).rejects.toThrow("KMS did not return a signature");
  });
});

describe("getJwks", () => {
  // RSA keypair generation is real, CPU-bound work (unlike the mocked KMS
  // call) - generating it once per test file instead of once per test
  // avoids doubling that cost and flaking past vitest's 5s default timeout
  // under a loaded/throttled CI runner (seen in practice on GitHub Actions).
  let der: Buffer;

  beforeAll(() => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    der = publicKey.export({ format: "der", type: "spki" });
  });

  it("converts a KMS DER-encoded SPKI public key into a JWK with the given kid", async () => {
    kmsMock.on(GetPublicKeyCommand).resolves({ PublicKey: der });

    const jwks = await getJwks("key-id", "kid-1");
    expect(jwks.keys).toHaveLength(1);

    const jwk = jwks.keys[0];
    expect(jwk.kty).toBe("RSA");
    expect(jwk.kid).toBe("kid-1");
    expect(jwk.use).toBe("sig");
    expect(jwk.alg).toBe("RS256");
    expect(typeof jwk.n).toBe("string");
    expect(typeof jwk.e).toBe("string");
  });

  it("passes the given KMS key id through to GetPublicKeyCommand", async () => {
    kmsMock.on(GetPublicKeyCommand).resolves({ PublicKey: der });

    await getJwks("my-key-id", "kid-1");

    const calls = kmsMock.commandCalls(GetPublicKeyCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toMatchObject({ KeyId: "my-key-id" });
  });

  it("throws when KMS returns no public key", async () => {
    kmsMock.on(GetPublicKeyCommand).resolves({});

    await expect(getJwks("key-id", "kid-1")).rejects.toThrow("KMS did not return a public key");
  });
});
