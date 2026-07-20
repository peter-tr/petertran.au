import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import {
  LambdaClient,
  PutProvisionedConcurrencyConfigCommand,
  DeleteProvisionedConcurrencyConfigCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-lambda";
import { SSMClient, GetParameterCommand, PutParameterCommand } from "@aws-sdk/client-ssm";
import { parseJsonBody } from "api-shared/http";

const lambdaClient = new LambdaClient({});
const ssm = new SSMClient({});

const ALIAS_NAME = process.env.LIVE_ALIAS_NAME!;
const PARAM_NAME = process.env.PC_CONFIG_PARAM_NAME!;

type PcFunctionKey = "portfolio" | "pantry" | "imposter" | "zeroTrustLab";

// One flag can cover more than one target function - zero-trust-lab's 5
// Lambdas only work as a pipeline (edge-authorizer needs internal-sts warm
// too, domain-a's JWT verification needs internal-sts's JWKS endpoint
// reachable), so they reconcile together under a single flag rather than
// drifting independently.
const TARGETS_BY_FLAG: Record<PcFunctionKey, string[]> = {
  portfolio: [process.env.PORTFOLIO_FN_NAME!],
  pantry: [process.env.PANTRY_FN_NAME!],
  imposter: [process.env.IMPOSTER_FN_NAME!],
  zeroTrustLab: [
    process.env.ZTL_IDP_BRIDGE_FN_NAME!,
    process.env.ZTL_INTERNAL_STS_FN_NAME!,
    process.env.ZTL_EDGE_AUTHORIZER_FN_NAME!,
    process.env.ZTL_EDGE_PROXY_FN_NAME!,
    process.env.ZTL_DOMAIN_A_FN_NAME!,
  ],
};

type PcFlags = Record<PcFunctionKey, boolean>;

// On (business-hours PC scheduling active) by default - matches how
// warmup's schedules are also ENABLED at creation.
const DEFAULT_FLAGS: PcFlags = { portfolio: true, pantry: true, imposter: true, zeroTrustLab: true };

async function getFlags(): Promise<PcFlags> {
  const { Parameter } = await ssm.send(new GetParameterCommand({ Name: PARAM_NAME }));
  if (!Parameter?.Value) return DEFAULT_FLAGS;

  // Merge over the default so a flag added after this parameter was first
  // written still gets a sane value, same reasoning as getSettings()'s
  // {...DEFAULT_SETTINGS, ...stored} merge elsewhere in this codebase.
  return { ...DEFAULT_FLAGS, ...(JSON.parse(Parameter.Value) as Partial<PcFlags>) };
}

async function setFlags(flags: PcFlags): Promise<void> {
  await ssm.send(new PutParameterCommand({ Name: PARAM_NAME, Value: JSON.stringify(flags), Overwrite: true }));
}

// 8am-7pm Australia/Sydney, every day - the one window Provisioned
// Concurrency is allowed to be on for, regardless of what the per-function
// flag says.
function isWithinSydneyBusinessHours(now: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hour12: false }).format(now)
  );

  return hour >= 8 && hour < 19;
}

// Never throws - applying PC is best-effort. The flag itself (what the user
// asked for) is already durably saved in SSM by the time this runs; if AWS
// can't actually grant PC right now (e.g. the account's concurrency quota
// has no room - seen live, since this account's quota is pinned at 10, the
// bare minimum AWS allows before refusing any Provisioned Concurrency at
// all), that's a transient infra condition, not a reason to fail the
// request or the other targets' reconciliation in the same tick.
async function reconcileTarget(functionName: string, shouldBeWarm: boolean): Promise<void> {
  try {
    if (shouldBeWarm) {
      await lambdaClient.send(
        new PutProvisionedConcurrencyConfigCommand({
          FunctionName: functionName,
          Qualifier: ALIAS_NAME,
          ProvisionedConcurrentExecutions: 1,
        })
      );
      return;
    }

    await lambdaClient.send(
      new DeleteProvisionedConcurrencyConfigCommand({ FunctionName: functionName, Qualifier: ALIAS_NAME })
    );
  } catch (err) {
    // Already in the desired (no PC) state - not an error.
    if (err instanceof ResourceNotFoundException) return;
    console.error(`reconcileTarget(${functionName}) failed - PC left as-is, will retry next tick`, err);
  }
}

// Idempotent - safe to call redundantly. Called both by the hourly
// {reconcile: true} tick (for every flag every hour) and directly by the
// POST handler below (for just the one flag that changed), so a toggle
// takes effect immediately instead of waiting for the next hourly tick.
async function reconcileFlag(key: PcFunctionKey, enabled: boolean, now: Date): Promise<void> {
  const shouldBeWarm = enabled && isWithinSydneyBusinessHours(now);
  await Promise.all(TARGETS_BY_FLAG[key].map((functionName) => reconcileTarget(functionName, shouldBeWarm)));
}

interface ReconcilePing {
  reconcile: true;
}

function isReconcilePing(event: unknown): event is ReconcilePing {
  return typeof event === "object" && event !== null && (event as { reconcile?: unknown }).reconcile === true;
}

export async function handler(
  event: APIGatewayProxyEventV2 | ReconcilePing
): Promise<APIGatewayProxyStructuredResultV2> {
  if (isReconcilePing(event)) {
    const flags = await getFlags();
    const now = new Date();
    await Promise.all(
      (Object.keys(TARGETS_BY_FLAG) as PcFunctionKey[]).map((key) => reconcileFlag(key, flags[key], now))
    );

    return { statusCode: 200, body: "reconciled" };
  }

  if (event.requestContext.http.method === "POST") {
    const body = parseJsonBody<{ function?: string; enabled?: boolean }>(event);
    if (
      !body.function ||
      !(body.function in TARGETS_BY_FLAG) ||
      typeof body.enabled !== "boolean"
    ) {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          error: "function must be one of portfolio/pantry/imposter/zeroTrustLab, enabled must be a boolean",
        }),
      };
    }
    const key = body.function as PcFunctionKey;

    const flags = await getFlags();
    flags[key] = body.enabled;
    await setFlags(flags);
    await reconcileFlag(key, body.enabled, new Date());

    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(flags) };
  }

  const flags = await getFlags();

  return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(flags) };
}
