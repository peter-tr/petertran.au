import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  LambdaClient,
  PutProvisionedConcurrencyConfigCommand,
  DeleteProvisionedConcurrencyConfigCommand,
  GetFunctionConfigurationCommand,
  GetProvisionedConcurrencyConfigCommand,
  UpdateFunctionConfigurationCommand,
  PublishVersionCommand,
  UpdateAliasCommand,
  ResourceNotFoundException,
  ProvisionedConcurrencyConfigNotFoundException,
} from "@aws-sdk/client-lambda";
import { SSMClient, GetParameterCommand, PutParameterCommand } from "@aws-sdk/client-ssm";
import { SchedulerClient, GetScheduleCommand, UpdateScheduleCommand } from "@aws-sdk/client-scheduler";
import { parseJsonBody, corsHeaders } from "api-shared/http";

const lambdaClient = new LambdaClient({});
const ssm = new SSMClient({});
const scheduler = new SchedulerClient({});

const ALIAS_NAME = process.env.LIVE_ALIAS_NAME!;
const PARAM_NAME = process.env.WARM_SCHEDULE_PARAM_NAME!;
const PROFILES_PARAM_NAME = process.env.WARM_SCHEDULE_PROFILES_PARAM_NAME!;
// CDK-provided map of each project's on/off EventBridge Schedule names -
// see infra/lib/warm-schedule-stack.ts.
const SCHEDULE_NAMES: Record<WarmScheduleKey, { on: string; off: string }> = JSON.parse(
  process.env.WARM_SCHEDULE_NAMES!
);

type WarmScheduleKey = "portfolio" | "pantry" | "imposter" | "supergraph" | "designStudio" | "zeroTrustLab";
type Weekday = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

interface WarmSchedule {
  enabled: boolean;
  days: Weekday[];
  start: string; // "HH:MM", 24h, Sydney-local
  end: string; // "HH:MM", must be > start - same-day windows only
  concurrency: number; // ProvisionedConcurrentExecutions granted to every target while within window
  memoryMb: number; // every target's Lambda memory, applied via reconcileMemory()
}

type WarmScheduleConfig = Record<WarmScheduleKey, WarmSchedule>;
// Named full-config snapshots (all 6 projects at once), keyed by
// user-chosen name - lets the settings page save/apply a whole mode (e.g.
// "all cold, 1024MB") in one action instead of editing every project's row.
type WarmScheduleProfiles = Record<string, WarmScheduleConfig>;

const MAX_PROFILE_NAME_LENGTH = 60;

// Real ap-southeast-2 Provisioned Concurrency rate (AWS Pricing API,
// effective 2026-07-01) - see the 2026-07-20 PC rollout's pricing pull.
// Charged per GB-second regardless of invocation - this is what makes a
// concurrency unit's cost purely a function of memory size + how long it's
// granted for, independent of traffic.
const PC_PRICE_PER_GB_SECOND_USD = 0.000005236;
const SECONDS_PER_HOUR = 3600;
// Calendar months aren't a whole number of weeks - average weeks/month
// (365.25 / 7 / 12) so a schedule's cost projects consistently regardless
// of which month it's viewed in.
const WEEKS_PER_MONTH = 365.25 / 7 / 12;

interface ProjectCost {
  // Real, currently-allocated PC units across every target Lambda in this
  // project right now (0 outside the window, or while AWS is still
  // provisioning/tearing down) - not the configured `concurrency`, which is
  // only the desired value.
  liveConcurrency: number;
  // $/hr this project is costing right now, from each target's real
  // (queried) memory size times its real allocated concurrency.
  liveHourlyCostUsd: number;
  // $/mo if the configured schedule runs as set - configured `memoryMb`
  // times the configured `concurrency`, times the schedule's actual weekly
  // hours. Uses the schedule's own memoryMb (not the live-queried one) so
  // this reflects what a pending memory choice will cost once reconciled,
  // not what's costing right now.
  scheduledMonthlyCostUsd: number;
}

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

// Curated, not free-form - these are this codebase's own actually-tested
// tiers (see the 2026-07-25 cold-start investigation): 512MB showed a real
// but small warm-invocation cost (~10-20ms) against a real DynamoDB-backed
// query, while 1536/2048/3008 showed no further Init Duration improvement
// over 1024MB at all. web/src/portfolio/hooks/useWarmSchedule.ts mirrors
// this value for the settings page's own dropdown - keep the two in sync.
const MEMORY_OPTIONS_MB = [512, 1024, 1536, 2048] as const;

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
  designStudio: [process.env.DESIGN_STUDIO_FN_NAME!],
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
  memoryMb: 512,
};
const DEFAULT_CONFIG: WarmScheduleConfig = {
  portfolio: DEFAULT_SCHEDULE,
  pantry: DEFAULT_SCHEDULE,
  imposter: DEFAULT_SCHEDULE,
  supergraph: DEFAULT_SCHEDULE,
  designStudio: DEFAULT_SCHEDULE,
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

async function getProfiles(): Promise<WarmScheduleProfiles> {
  const { Parameter } = await ssm.send(new GetParameterCommand({ Name: PROFILES_PARAM_NAME }));
  if (!Parameter?.Value) return {};

  return JSON.parse(Parameter.Value) as WarmScheduleProfiles;
}

async function setProfiles(profiles: WarmScheduleProfiles): Promise<void> {
  await ssm.send(
    new PutParameterCommand({ Name: PROFILES_PARAM_NAME, Value: JSON.stringify(profiles), Overwrite: true })
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

function hoursPerWeek(schedule: WarmSchedule): number {
  if (!schedule.enabled) return 0;

  const [startHour, startMinute] = schedule.start.split(":").map(Number);
  const [endHour, endMinute] = schedule.end.split(":").map(Number);
  const hoursPerDay = endHour + endMinute / 60 - (startHour + startMinute / 60);

  return schedule.days.length * hoursPerDay;
}

// Real, currently-allocated memory + PC count for one Lambda's `live`
// alias - queried live rather than trusted from config, since the actual
// allocated count can lag the desired one (still provisioning/tearing
// down) and memory size can change independent of this stack (a manual
// rightsizing pass, e.g. the 2026-07-20 512MB -> 256MB change).
async function getTargetLiveState(
  functionName: string
): Promise<{ memoryMb: number; allocatedConcurrency: number }> {
  const [configResult, pcResult] = await Promise.all([
    lambdaClient.send(
      new GetFunctionConfigurationCommand({ FunctionName: functionName, Qualifier: ALIAS_NAME })
    ),
    lambdaClient
      .send(new GetProvisionedConcurrencyConfigCommand({ FunctionName: functionName, Qualifier: ALIAS_NAME }))
      .catch((err) => {
        // No PC currently configured for this target - 0 allocated, not an
        // error (same as reconcileTarget's own handling of this case).
        // GetProvisionedConcurrencyConfig reports this as
        // ProvisionedConcurrencyConfigNotFoundException, not the
        // ResourceNotFoundException other Lambda PC calls use.
        if (err instanceof ProvisionedConcurrencyConfigNotFoundException) return null;
        if (err instanceof ResourceNotFoundException) return null;
        throw err;
      }),
  ]);

  return {
    memoryMb: configResult.MemorySize ?? 0,
    allocatedConcurrency: pcResult?.AllocatedProvisionedConcurrentExecutions ?? 0,
  };
}

async function computeProjectCost(key: WarmScheduleKey, schedule: WarmSchedule): Promise<ProjectCost> {
  const targetStates = await Promise.all(TARGETS_BY_PROJECT[key].map(getTargetLiveState));

  const scheduledMemoryGb = schedule.memoryMb / 1024;
  let liveConcurrency = 0;
  let liveHourlyCostUsd = 0;
  let scheduledHourlyCostUsd = 0;
  for (const { memoryMb, allocatedConcurrency } of targetStates) {
    const liveMemoryGb = memoryMb / 1024;
    liveConcurrency += allocatedConcurrency;
    liveHourlyCostUsd += liveMemoryGb * allocatedConcurrency * PC_PRICE_PER_GB_SECOND_USD * SECONDS_PER_HOUR;
    scheduledHourlyCostUsd +=
      scheduledMemoryGb * schedule.concurrency * PC_PRICE_PER_GB_SECOND_USD * SECONDS_PER_HOUR;
  }

  return {
    liveConcurrency,
    liveHourlyCostUsd,
    scheduledMonthlyCostUsd: scheduledHourlyCostUsd * hoursPerWeek(schedule) * WEEKS_PER_MONTH,
  };
}

async function computeAllProjectCosts(
  config: WarmScheduleConfig
): Promise<Record<WarmScheduleKey, ProjectCost>> {
  const keys = Object.keys(TARGETS_BY_PROJECT) as WarmScheduleKey[];
  const costs = await Promise.all(keys.map((key) => computeProjectCost(key, config[key])));

  return Object.fromEntries(keys.map((key, i) => [key, costs[i]])) as Record<WarmScheduleKey, ProjectCost>;
}

// Memory is baked into each published Lambda Version, unlike PC (a
// lightweight grant against an alias qualifier) - changing it means
// UpdateFunctionConfiguration (mutates $LATEST) -> wait for that to land ->
// PublishVersion -> UpdateAlias (move `live` to the new version). Only runs
// the sequence when live memory actually differs from desired.
//
// No separate "clean up the old version's PC" step - verified live against
// a throwaway Lambda that PC granted on an alias qualifier automatically
// re-provisions against wherever the alias points after UpdateAlias
// (list-provisioned-concurrency-configs showed exactly one record the whole
// time, keyed to the alias, not a version), so the existing PC grant/delete
// call below (which reconcileTarget already runs on every tick regardless)
// is sufficient on its own.
async function reconcileMemory(functionName: string, desiredMemoryMb: number): Promise<void> {
  const { MemorySize } = await lambdaClient.send(
    new GetFunctionConfigurationCommand({ FunctionName: functionName, Qualifier: ALIAS_NAME })
  );
  if (MemorySize === desiredMemoryMb) return;

  await lambdaClient.send(
    new UpdateFunctionConfigurationCommand({ FunctionName: functionName, MemorySize: desiredMemoryMb })
  );

  // UpdateFunctionConfiguration is asynchronous - PublishVersion while an
  // update is still in progress either fails or snapshots stale config, so
  // wait for it to land first. In practice this completes in a few seconds;
  // 15 attempts at 2s apart is a generous ceiling, not an expected duration.
  for (let attempt = 0; attempt < 15; attempt++) {
    const { LastUpdateStatus } = await lambdaClient.send(
      new GetFunctionConfigurationCommand({ FunctionName: functionName })
    );
    if (LastUpdateStatus !== "InProgress") break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const { Version } = await lambdaClient.send(new PublishVersionCommand({ FunctionName: functionName }));
  await lambdaClient.send(
    new UpdateAliasCommand({ FunctionName: functionName, Name: ALIAS_NAME, FunctionVersion: Version })
  );
}

// Never throws - applying memory/PC is best-effort. The flag itself (what
// the user asked for) is already durably saved in SSM by the time this
// runs; if AWS can't actually apply it right now (e.g. the account's
// concurrency quota has no room), that's a transient infra condition, not a
// reason to fail the request or the other targets' reconciliation in the
// same tick.
//
// PC-on-alias failure mode (hit for real 2026-07-27, supergraph-graphql):
// if a deploy publishes a version that crashes at init, AWS Lambda's own
// alias+PC safety net keeps 100% of traffic pinned to the last version
// that successfully warmed (via an internal weighted RoutingConfig on the
// alias) rather than cutting over to a version PC can't warm - real
// traffic stays safe, but the old version becomes permanently undeletable
// (an alias still references it), which stalls every subsequent deploy's
// CloudFormation cleanup phase ("stack ... is in
// UPDATE_COMPLETE_CLEANUP_IN_PROGRESS state and can not be updated",
// retrying forever without ever resolving on its own). Recovery once the
// real code fix is ready: `aws lambda delete-provisioned-concurrency-
// config --qualifier live` (an active PC config blocks any further
// `update-alias` call outright), then `aws lambda update-alias --function-
// version <last-known-good> --routing-config '{}'` to drop the stale
// weighting, then `aws lambda delete-function --qualifier <stuck-version>`
// to free it - only then does a fresh `cdk deploy` succeed.
async function reconcileTarget(
  functionName: string,
  shouldBeWarm: boolean,
  concurrency: number,
  memoryMb: number
): Promise<void> {
  try {
    await reconcileMemory(functionName, memoryMb);

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
    console.error(`reconcileTarget(${functionName}) failed - left as-is, will retry next tick`, err);
  }
}

async function reconcileProjectTo(
  key: WarmScheduleKey,
  shouldBeWarm: boolean,
  concurrency: number,
  memoryMb: number
): Promise<void> {
  await Promise.all(
    TARGETS_BY_PROJECT[key].map((functionName) =>
      reconcileTarget(functionName, shouldBeWarm, concurrency, memoryMb)
    )
  );
}

// Idempotent - safe to call redundantly. Called by the periodic backstop
// {reconcile: true} tick (for every project every ~30min), by the exact
// on/off trigger for just the project whose window opened/closed, and
// directly by the POST handler for just the projects that changed, so an
// edit takes effect immediately instead of waiting for the next trigger.
async function reconcileProject(key: WarmScheduleKey, schedule: WarmSchedule, now: Date): Promise<void> {
  await reconcileProjectTo(key, isWithinWindow(schedule, now), schedule.concurrency, schedule.memoryMb);
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

// Returns the updated profiles map directly, rather than making the caller
// re-fetch it from SSM right after this writes it - the response can build
// off this in-memory value instead of a redundant read.
async function saveProfile(name: string): Promise<WarmScheduleProfiles> {
  const [config, profiles] = await Promise.all([getConfig(), getProfiles()]);
  const updated = { ...profiles, [name]: config };
  await setProfiles(updated);

  return updated;
}

async function deleteProfile(name: string): Promise<WarmScheduleProfiles> {
  const profiles = await getProfiles();
  const updated = { ...profiles };
  delete updated[name];
  await setProfiles(updated);

  return updated;
}

// Loads `name`'s saved config as the new live config and applies it exactly
// like an individual project Save does (updateProjectSchedules +
// reconcileProject), just for all 6 projects at once. Returns null (without
// touching anything) if no profile by that name exists.
async function applyProfile(name: string): Promise<WarmScheduleConfig | null> {
  const profiles = await getProfiles();
  const config = profiles[name];
  if (!config) return null;

  await setConfig(config);

  const now = new Date();
  await Promise.all(
    (Object.keys(TARGETS_BY_PROJECT) as WarmScheduleKey[]).map((key) =>
      Promise.all([updateProjectSchedules(key, config[key]), reconcileProject(key, config[key], now)])
    )
  );

  return config;
}

// Takes `profiles` as a parameter rather than fetching it itself - every
// call site already has the current value in hand (either just wrote it via
// saveProfile/deleteProfile, or knows it's untouched by whatever it just
// did), so a fresh getProfiles() here would be a redundant SSM read at best
// and, right after a write, a stale one at worst (SSM's own read here
// wouldn't necessarily reflect a Put this same request just issued).
async function buildStatus(
  config: WarmScheduleConfig,
  profiles: WarmScheduleProfiles
): Promise<{
  schedules: WarmScheduleConfig;
  costs: Record<WarmScheduleKey, ProjectCost>;
  profiles: WarmScheduleProfiles;
}> {
  const costs = await computeAllProjectCosts(config);

  return { schedules: config, costs, profiles };
}

function isValidProfileName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_PROFILE_NAME_LENGTH;
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
    s.concurrency <= MAX_CONCURRENCY &&
    typeof s.memoryMb === "number" &&
    (MEMORY_OPTIONS_MB as readonly number[]).includes(s.memoryMb)
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
    // Unlike the on/off action, concurrency/memory aren't part of the
    // trigger payload itself (the EventBridge Schedule's input is just
    // {project, action}, set once at CDK synth time / on a settings save) -
    // fetch the current config to know how much concurrency to grant and
    // which memory size to reconcile toward.
    const config = await getConfig();
    await reconcileProjectTo(
      event.project,
      event.action === "on",
      config[event.project].concurrency,
      config[event.project].memoryMb
    );

    return { statusCode: 200, body: "reconciled" };
  }

  if (event.httpMethod === "POST") {
    const body = parseJsonBody<{
      schedules?: unknown;
      profileAction?: string;
      name?: unknown;
    }>(event);

    if (body.profileAction !== undefined) {
      if (
        (body.profileAction !== "save" &&
          body.profileAction !== "apply" &&
          body.profileAction !== "delete") ||
        !isValidProfileName(body.name)
      ) {
        return {
          statusCode: 400,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            error: `profileAction must be save/apply/delete, name must be a non-empty string up to ${MAX_PROFILE_NAME_LENGTH} chars`,
          }),
        };
      }

      const name = body.name;
      let config: WarmScheduleConfig;
      let profiles: WarmScheduleProfiles;

      if (body.profileAction === "save") {
        profiles = await saveProfile(name);
        config = await getConfig();
      } else if (body.profileAction === "delete") {
        profiles = await deleteProfile(name);
        config = await getConfig();
      } else {
        const applied = await applyProfile(name);
        if (!applied) {
          return {
            statusCode: 400,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ error: `no saved profile named "${name}"` }),
          };
        }
        config = applied;
        profiles = await getProfiles();
      }

      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(await buildStatus(config, profiles)),
      };
    }

    const entries =
      body.schedules && typeof body.schedules === "object" && !Array.isArray(body.schedules)
        ? (Object.entries(body.schedules) as [string, unknown][])
        : null;
    const isValidEntries =
      entries !== null &&
      entries.length > 0 &&
      entries.every(([key, schedule]) => key in TARGETS_BY_PROJECT && isValidSchedule(schedule));

    if (!isValidEntries) {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          error:
            "schedules must be a non-empty object mapping project name " +
            "(portfolio/pantry/imposter/supergraph/designStudio/zeroTrustLab) to a valid " +
            "{ enabled, days, start, end, concurrency, memoryMb } " +
            `(concurrency an integer 1-${MAX_CONCURRENCY}, memoryMb one of ${MEMORY_OPTIONS_MB.join("/")})`,
        }),
      };
    }

    // Every dirty project is merged into `config` and persisted in a single
    // getConfig/setConfig round trip - saving them via separate concurrent
    // POSTs (the previous shape of this endpoint) raced: each request's
    // getConfig() could read the SSM parameter before a sibling request's
    // setConfig() had written its own change, so whichever request's
    // setConfig() landed last silently clobbered the others back out. This
    // is what made the settings page's "Save all" button appear to save
    // only the most recently edited project.
    const validEntries = entries as [WarmScheduleKey, WarmSchedule][];
    const config = await getConfig();
    for (const [key, schedule] of validEntries) {
      config[key] = schedule;
    }
    await setConfig(config);

    const now = new Date();
    await Promise.all(
      validEntries.map(([key, schedule]) =>
        Promise.all([updateProjectSchedules(key, schedule), reconcileProject(key, schedule, now)])
      )
    );

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(await buildStatus(config, await getProfiles())),
    };
  }

  const config = await getConfig();

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(await buildStatus(config, await getProfiles())),
  };
}

export async function handler(
  event: APIGatewayProxyEvent | ReconcilePing | WarmScheduleTrigger
): Promise<APIGatewayProxyResult> {
  const result = await processEvent(event);
  const origin = isReconcilePing(event) || isWarmScheduleTrigger(event) ? undefined : event.headers?.origin;

  return { ...result, headers: { ...result.headers, ...corsHeaders(origin) } };
}
