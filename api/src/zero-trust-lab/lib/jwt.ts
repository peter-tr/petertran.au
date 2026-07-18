import { KMSClient, SignCommand, GetPublicKeyCommand } from "@aws-sdk/client-kms";
import { createPublicKey } from "crypto";

const kms = new KMSClient({});

// RSA (not EC) deliberately - KMS's RSASSA_PKCS1_V1_5_SHA_256 signature bytes
// are already in the exact format a JWS RS256 signature needs. An EC key
// would mean converting KMS's DER-encoded ECDSA signature into the raw R||S
// concatenation JWS expects - extra code with no benefit for a lab this size.
const SIGNING_ALGORITHM = "RSASSA_PKCS1_V1_5_SHA_256";
const JWT_ALG = "RS256";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export interface JwtClaims {
  sub: string;
  aud: string;
  iss: string;
  scope?: string;
}

export async function signJwt(claims: JwtClaims, kmsKeyId: string, kid: string, ttlSeconds = 120): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: JWT_ALG, typ: "JWT", kid };
  const payload = { ...claims, iat: now, exp: now + ttlSeconds };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

  const { Signature } = await kms.send(
    new SignCommand({
      KeyId: kmsKeyId,
      Message: Buffer.from(signingInput),
      MessageType: "RAW",
      SigningAlgorithm: SIGNING_ALGORITHM,
    })
  );
  if (!Signature) throw new Error("KMS did not return a signature");

  return `${signingInput}.${base64url(Buffer.from(Signature))}`;
}

export interface Jwk {
  kty: string;
  n: string;
  e: string;
  kid: string;
  use: string;
  alg: string;
}

export async function getJwks(kmsKeyId: string, kid: string): Promise<{ keys: Jwk[] }> {
  const { PublicKey } = await kms.send(new GetPublicKeyCommand({ KeyId: kmsKeyId }));
  if (!PublicKey) throw new Error("KMS did not return a public key");

  const keyObject = createPublicKey({ key: Buffer.from(PublicKey), format: "der", type: "spki" });
  const jwk = keyObject.export({ format: "jwk" }) as { kty: string; n: string; e: string };

  return { keys: [{ ...jwk, kid, use: "sig", alg: JWT_ALG }] };
}
