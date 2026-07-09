import Anthropic from "@anthropic-ai/sdk";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

let cachedClient: Anthropic | null = null;

export async function getAnthropicClient(): Promise<Anthropic> {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.ANTHROPIC_API_KEY ?? (await fetchApiKeyFromSecretsManager());
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

async function fetchApiKeyFromSecretsManager(): Promise<string> {
  const secretArn = process.env.ANTHROPIC_SECRET_ARN;
  if (!secretArn) {
    throw new Error("Neither ANTHROPIC_API_KEY nor ANTHROPIC_SECRET_ARN is configured.");
  }

  const client = new SecretsManagerClient({});
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!res.SecretString) {
    throw new Error("Anthropic API key secret has no string value.");
  }
  return res.SecretString;
}
