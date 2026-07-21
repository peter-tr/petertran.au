import { MongoClient, type Db } from "mongodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { captureAwsClient } from "api-shared/xray";

let cachedDb: Promise<Db> | null = null;

// Created once at module scope, not per-invocation - Lambda reuses the
// execution context across warm invocations, so this keeps the connection
// pool alive between requests instead of reconnecting on every call. Same
// "expensive setup happens once, outside the handler" shape as
// api-shared/anthropic-client.ts's cachedClient, just for a driver
// connection instead of an AWS SDK client.
export function getDb(): Promise<Db> {
  if (!cachedDb) cachedDb = connect();
  return cachedDb;
}

async function connect(): Promise<Db> {
  const uri = process.env.MONGO_URI ?? (await fetchUriFromSecretsManager());
  const client = new MongoClient(uri);
  await client.connect();

  return client.db("design-studio");
}

async function fetchUriFromSecretsManager(): Promise<string> {
  const secretArn = process.env.MONGO_SECRET_ARN;
  if (!secretArn) {
    throw new Error("Neither MONGO_URI nor MONGO_SECRET_ARN is configured.");
  }

  const client = captureAwsClient(new SecretsManagerClient({}));
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!res.SecretString) {
    throw new Error("Mongo connection string secret has no string value.");
  }

  return res.SecretString;
}
