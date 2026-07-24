import { MongoClient, type Db } from "mongodb";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

let cachedDb: Promise<Db> | null = null;

function connectAndCache(): Promise<Db> {
  const attempt = connect();
  cachedDb = attempt;
  attempt.catch(() => {
    // Don't let a failed connection permanently wedge this container - reset
    // so the next getDb() call retries instead of replaying the same
    // rejection forever. Guarded on identity in case a newer attempt has
    // already superseded this one by the time it rejects.
    if (cachedDb === attempt) cachedDb = null;
  });

  return attempt;
}

// Kicked off eagerly at module load, not lazily on first request - Lambda's
// INIT phase (module load, plus Provisioned Concurrency's pre-warming) isn't
// billed against request latency, so this pays the Mongo connection setup
// (Secrets Manager fetch/TLS handshake) there instead of on a customer's
// first request. The .catch() inside connectAndCache is required: an
// eagerly-created promise that later rejects with nothing yet awaiting it is
// an unhandled rejection, and Node 20 terminates the process on those by
// default - which would take down the whole execution environment before
// any request arrives.
connectAndCache();

// Created once at module scope, not per-invocation - Lambda reuses the
// execution context across warm invocations, so this keeps the connection
// pool alive between requests instead of reconnecting on every call. Same
// "expensive setup happens once, outside the handler" shape as
// api-shared/anthropic-client.ts's cachedClient, just for a driver
// connection instead of an AWS SDK client.
export function getDb(): Promise<Db> {
  return cachedDb ?? connectAndCache();
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

  const client = new SecretsManagerClient({});
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!res.SecretString) {
    throw new Error("Mongo connection string secret has no string value.");
  }

  return res.SecretString;
}
