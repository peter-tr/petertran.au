import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  LambdaClient,
  PutProvisionedConcurrencyConfigCommand,
  DeleteProvisionedConcurrencyConfigCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-lambda";
import { SSMClient, GetParameterCommand, PutParameterCommand } from "@aws-sdk/client-ssm";
import { SchedulerClient, GetScheduleCommand, UpdateScheduleCommand } from "@aws-sdk/client-scheduler";
import { parseJsonBody, corsHeaders } from "api-shared/http";

const lambdaClient = new LambdaClient({});
const ssm = new SSMClient({});
const scheduler = new SchedulerClient({});

const ALIAS_NAME = process.env.LIVE_ALIAS_NAME!;
const PARAM_NAME = process.env.WARM_SCHEDULE_PARAM_NAME!;
// CDK-provided map of each project's on/off EventBridge Schedule names -
// see infra/lib/warm-schedule-stack.ts.
const SCHEDULE_NAMES: Record<WarmScheduleKey, { on: string; off: string }> = JSON.parse(
  process.env.WARM_SCHEDULE_NAMES!
);

type WarmScheduleKey = "portfolio" | "pantry" | "imposter" | "supergraph" | "zeroTrustLab";
type Weekday = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

interface WarmSchedule {
  enabled: boolean;
  days: Weekday[];
  start: string; // "HH:MM", 24h, Sydney-local
  end: string; // "HH:MM", must be > start - same-day windows only
  concurrency: number; // ProvisionedConcurrentExecutions granted to every target while within window
}

type WarmScheduleConfig = Record<WarmScheduleKey, WarmSchedule>;

const ALL_WEEKDAYS: Weekday[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

// Settings-page upper bound on concurrency. A personal site's concurrent-
// request bursts (a single page load firing several parallel GraphQL
// queries) topped out at 4-5 in practice (see the 2026-07-21 supergraph
// cold-start investigation's ConcurrentExecutions measurements), so
// anything past this is far more likely a typo than an intentional choice -
// and each unit is real ongoing cost (~$2/mo per unit at 256MB over a
// 14h/day window). web/src/portfolio/hooks/useWarmSchedule.ts mirrors this
// value for the settings page's own input bound - keep the two in sync.
const MAX_CONCURRENCY = 5;

// One flag/schedule can cover more than one target function - zero-trust-lab's
// 5 Lambdas only work as a pipeline (edge-authorizer needs internal-sts warm
// too, domain-a's JWT verification needs internal-sts's JWKS endpoint
// reachable), so they reconcile together under a single project rather than
// drifting independently.
const TARGETS_BY_PROJECT: Record<WarmScheduleKey, string[]> = {
  portfolio: [process.env.PORTFOLIO_FN_NAME!],
  pantry: [process.env.PANTRY_FN_NAME!],
  imposter: [process.env.IMPOSTER_FN_NAME!],
  supergraph: [process.env.SUPERGRAPH_FN_NAME!],
  zeroTrustLab: [
    process.env.ZTL_IDP_BRIDGE_FN_NAME!,
    process.env.ZTL_INTERNAL_STS_FN_NAME!,
    process.env.ZTL_EDGE_AUTHORIZER_FN_NAME!,
    process.env.ZTL_EDGE_PROXY_FN_NAME!,
    process.env.ZTL_DOMAIN_A_FN_NAME!,
  ],
};

// On (business-hours PC scheduling active) by default, 8am-7pm every day,
// 1 provisioned instance - matches how warmup's schedules used to be
// ENABLED at creation, and this stack's original fixed window.
const DEFAULT_SCHEDULE: WarmSchedule = {
  enabled: true,
  days: ALL_WEEKDAYS,
  start: "08:00",
  end: "19:00",
  concurrency: 1,
};
const DEFAULT_CONFIG: WarmScheduleConfig = {
  portfolio: DEFAULT_SCHEDULE,
  pantry: DEFAULT_SCHEDULE,
  imposter: DEFAULT_SCHEDULE,
  supergraph: DEFAULT_SCHEDULE,
  zeroTrustLab: DEFAULT_SCHEDULE,
};

async function getConfig(): Promise<WarmScheduleConfig> {
  const { Parameter } = await ssm.send(new GetParameterCommand({ Name: PARAM_NAME }));
  if (!Parameter?.Value) return DEFAULT_CONFIG;

  // Merge per-project over the default (not just top-level) so a project
  // added after this parameter was first written, or a stored value that
  // predates a field being added to WarmSchedule (e.g. concurrency), still
  // gets a complete, sane schedule - same reasoning as getSettings()'s
  // {...DEFAULT_SETTINGS, ...stored} merge elsewhere in this codebase.
  const stored = JSON.parse(Parameter.Value) as Partial<Record<WarmScheduleKey, Partial<WarmSchedule>>>;
  const merged = {} as WarmScheduleConfig;
  for (const key of Object.keys(DEFAULT_CONFIG) as WarmScheduleKey[]) {
    merged[key] = { ...DEFAULT_CONFIG[key], ...stored[key] };
  }

  return merged;
}

async function setConfig(config: WarmScheduleConfig): Promise<void> {
  await ssm.send(
    new PutParameterCommand({ Name: PARAM_NAME, Value: JSON.stringify(config), Overwrite: true })
  );
}

// Sydney weekday + "HH:MM" for `now`, so an enabled schedule with `days`/
// `start`/`end` can be checked against the current moment.
function sydneyNow(now: Date): { weekday: Weekday; time: string } {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const weekday = parts
    .find((p) => p.type === "weekday")!
    .value.toUpperCase()
    .slice(0, 3) as Weekday;
  const hour = parts.find((p) => p.type === "hour")!.value;
  const minute = parts.find((p) => p.type === "minute")!.value;

  return { weekday, time: `${hour}:${minute}` };
}

function isWithinWindow(schedule: WarmSchedule, now: Date): boolean {
  if (!schedule.enabled) return false;

  const { weekday, time } = sydneyNow(now);

  return schedule.days.includes(weekday) && schedule.start <= time && time < schedule.end;
}

// Never throws - applying PC is best-effort. The flag itself (what the user
// asked for) is already durably saved in SSM by the time this runs; if AWS
// can't actually grant PC right now (e.g. the account's concurrency quota
// has no room), that's a transient infra condition, not a reason to fail the
// request or the other targets' reconciliation in the same tick.
async function reconcileTarget(
  functionName: string,
  shouldBeWarm: boolean,
  concurrency: number
): Promise<void> {
  try {
    if (shouldBeWarm) {
      await lambdaClient.send(
        new PutProvisionedConcurrencyConfigCommand({
          FunctionName: functionName,
          Qualifier: ALIAS_NAME,
          ProvisionedConcurrentExecutions: concurrency,
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

async function reconcileProjectTo(
  key: WarmScheduleKey,
  shouldBeWarm: boolean,
  concurrency: number
): Promise<void> {
  await Promise.all(
    TARGETS_BY_PROJECT[key].map((functionName) => reconcileTarget(functionName, shouldBeWarm, concurrency))
  );
}

// Idempotent - safe to call redundantly. Called by the periodic backstop
// {reconcile: true} tick (for every project every ~30min), by the exact
// on/off trigger for just the project whose window opened/closed, and
// directly by the POST handler for just the project that changed, so an
// edit takes effect immediately instead of waiting for the next trigger.
async function reconcileProject(key: WarmScheduleKey, schedule: WarmSchedule, now: Date): Promise<void> {
  await reconcileProjectTo(key, isWithinWindow(schedule, now), schedule.concurrency);
}

// Builds the AWS cron fields for a project's on/off EventBridge Schedule
// from its configured days + a "HH:MM" time.
function cronFieldsFor(days: Weekday[], time: string): { minute: string; hour: string; weekDay: string } {
  const [hour, minute] = time.split(":");

  return { minute, hour, weekDay: days.join(",") };
}

// EventBridge Scheduler has no partial-patch call - Update requires
// resending the full schedule definition, so each edit re-fetches its own
// current definition first and only changes ScheduleExpression/State. Same
// idiom the old warmup-config Lambda used to toggle just State.
async function updateProjectSchedules(key: WarmScheduleKey, schedule: WarmSchedule): Promise<void> {
  const state = schedule.enabled ? "ENABLED" : "DISABLED";
  const { on, off } = SCHEDULE_NAMES[key];
  const onCron = cronFieldsFor(schedule.days, schedule.start);
  const offCron = cronFieldsFor(schedule.days, schedule.end);

  await Promise.all([
    (async () => {
      const current = await scheduler.send(new GetScheduleCommand({ Name: on }));
      await scheduler.send(
        new UpdateScheduleCommand({
          Name: on,
          ScheduleExpression: `cron(${onCron.minute} ${onCron.hour} ? * ${onCron.weekDay} *)`,
          ScheduleExpressionTimezone: "Australia/Sydney",
          FlexibleTimeWindow: current.FlexibleTimeWindow,
          Target: current.Target,
          State: state,
        })
      );
    })(),
    (async () => {
      const current = await scheduler.send(new GetScheduleCommand({ Name: off }));
      await scheduler.send(
        new UpdateScheduleCommand({
          Name: off,
          ScheduleExpression: `cron(${offCron.minute} ${offCron.hour} ? * ${offCron.weekDay} *)`,
          ScheduleExpressionTimezone: "Australia/Sydney",
          FlexibleTimeWindow: current.FlexibleTimeWindow,
          Target: current.Target,
          State: state,
        })
      );
    })(),
  ]);
}

interface ReconcilePing {
  reconcile: true;
}

function isReconcilePing(event: unknown): event is ReconcilePing {
  return typeof event === "object" && event !== null && (event as { reconcile?: unknown }).reconcile === true;
}

interface WarmScheduleTrigger {
  project: WarmScheduleKey;
  action: "on" | "off";
}

function isWarmScheduleTrigger(event: unknown): event is WarmScheduleTrigger {
  return (
    typeof event === "object" &&
    event !== null &&
    typeof (event as { project?: unknown }).project === "string" &&
    ((event as { action?: unknown }).action === "on" || (event as { action?: unknown }).action === "off")
  );
}

function isValidSchedule(value: unknown): value is WarmSchedule {
  if (typeof value !== "object" || value === null) return false;

  const s = value as Partial<WarmSchedule>;

  return (
    typeof s.enabled === "boolean" &&
    Array.isArray(s.days) &&
    s.days.every((d) => ALL_WEEKDAYS.includes(d as Weekday)) &&
    (!s.enabled || s.days.length > 0) &&
    typeof s.start === "string" &&
    typeof s.end === "string" &&
    /^\d{2}:\d{2}$/.test(s.start) &&
    /^\d{2}:\d{2}$/.test(s.end) &&
    s.start < s.end &&
    typeof s.concurrency === "number" &&
    Number.isInteger(s.concurrency) &&
    s.concurrency >= 1 &&
    s.concurrency <= MAX_CONCURRENCY
  );
}

async function processEvent(
  event: APIGatewayProxyEvent | ReconcilePing | WarmScheduleTrigger
): Promise<APIGatewayProxyResult> {
  if (isReconcilePing(event)) {
    const config = await getConfig();
    const now = new Date();
    await Promise.all(
      (Object.keys(TARGETS_BY_PROJECT) as WarmScheduleKey[]).map((key) =>
        reconcileProject(key, config[key], now)
      )
    );

    return { statusCode: 200, body: "reconciled" };
  }

  if (isWarmScheduleTrigger(event)) {
    // Unlike the on/off action, concurrency isn't part of the trigger
    // payload itself (the EventBridge Schedule's input is just
    // {project, action}, set once at CDK synth time / on a settings save) -
    // fetch the current config to know how much concurrency to grant.
    const config = await getConfig();
    await reconcileProjectTo(event.project, event.action === "on", config[event.project].concurrency);

    return { statusCode: 200, body: "reconciled" };
  }

  if (event.httpMethod === "POST") {
    const body = parseJsonBody<{ project?: string; schedule?: unknown }>(event);
    if (!body.project || !(body.project in TARGETS_BY_PROJECT) || !isValidSchedule(body.schedule)) {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          error:
            "project must be one of portfolio/pantry/imposter/supergraph/zeroTrustLab, schedule must be a " +
            `valid { enabled, days, start, end, concurrency } (concurrency an integer 1-${MAX_CONCURRENCY})`,
        }),
      };
    }

    const key = body.project as WarmScheduleKey;
    const schedule = body.schedule;

    const config = await getConfig();
    config[key] = schedule;
    await setConfig(config);
    await updateProjectSchedules(key, schedule);
    await reconcileProject(key, schedule, new Date());

    return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(config) };
  }

  const config = await getConfig();

  return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(config) };
}

export async function handler(
  event: APIGatewayProxyEvent | ReconcilePing | WarmScheduleTrigger
): Promise<APIGatewayProxyResult> {
  const result = await processEvent(event);
  const origin = isReconcilePing(event) || isWarmScheduleTrigger(event) ? undefined : event.headers?.origin;

  return { ...result, headers: { ...result.headers, ...corsHeaders(origin) } };
}
