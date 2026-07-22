import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as path from "path";
import { createLambdaAlarms } from "./shared/alarms";
import { FUNCTION_NAMES, TEST_FUNCTION_NAMES } from "./shared/function-names";

// Same inbox as the SES recipient identity in site-stack.ts - it's Peter's
// own address either way. Used both for the topic's email subscription
// below and passed to AlertsSettingsFunction, which needs it to find that
// exact subscription among the topic's (currently just one) subscriptions.
const ALARM_EMAIL = "peter2002tran@outlook.com";

interface MonitoredFunction {
  id: string;
  functionName: string;
  timeoutSeconds: number;
  project: string;
  // True for the GraphQL Lambdas that call emitOperationCountMetric /
  // createOperationMetricsPlugin (api-shared/operation-metrics.ts) - drives
  // whether that project gets a "GraphQL operations by name" widget.
  // Digest/price-check/warm-schedule/etc. aren't GraphQL APIs, so they never
  // set this.
  emitsGraphqlOperations?: boolean;
}

// Every prod Lambda across the independently-deployed projects (see
// CLAUDE.md's "api workspace structure"), imported here by plain name -
// not a live construct reference, same "no CloudFormation export lock-in"
// convention FUNCTION_NAMES's doc comment explains for
// ProvisionedConcurrencyStack/ApiGatewayStack. timeoutSeconds mirrors each
// function's actual configured `timeout` in its producing stack (kept in
// sync by hand - there's no live reference to read it from).
const PROD_FUNCTIONS: MonitoredFunction[] = [
  {
    id: "Portfolio",
    functionName: FUNCTION_NAMES.portfolio,
    timeoutSeconds: 30,
    project: "Portfolio",
    emitsGraphqlOperations: true,
  },
  {
    id: "Pantry",
    functionName: FUNCTION_NAMES.pantry,
    timeoutSeconds: 30,
    project: "Pantry",
    emitsGraphqlOperations: true,
  },
  { id: "PantryDigest", functionName: "pantry-digest", timeoutSeconds: 30, project: "Pantry" },
  { id: "PantryPriceCheck", functionName: "pantry-price-check", timeoutSeconds: 600, project: "Pantry" },
  {
    id: "Imposter",
    functionName: FUNCTION_NAMES.imposter,
    timeoutSeconds: 15,
    project: "Games",
    emitsGraphqlOperations: true,
  },
  { id: "Supergraph", functionName: FUNCTION_NAMES.supergraph, timeoutSeconds: 30, project: "Supergraph" },
  {
    id: "WarmSchedule",
    functionName: FUNCTION_NAMES.warmSchedule,
    timeoutSeconds: 10,
    project: "Warm Schedule",
  },
  {
    id: "ZtlIdpBridge",
    functionName: FUNCTION_NAMES.ztlIdpBridge,
    timeoutSeconds: 10,
    project: "Zero Trust Lab",
  },
  {
    id: "ZtlInternalSts",
    functionName: FUNCTION_NAMES.ztlInternalSts,
    timeoutSeconds: 10,
    project: "Zero Trust Lab",
  },
  {
    id: "ZtlEdgeAuthorizer",
    functionName: FUNCTION_NAMES.ztlEdgeAuthorizer,
    timeoutSeconds: 10,
    project: "Zero Trust Lab",
  },
  {
    id: "ZtlEdgeProxy",
    functionName: FUNCTION_NAMES.ztlEdgeProxy,
    timeoutSeconds: 10,
    project: "Zero Trust Lab",
  },
  {
    id: "ZtlDomainA",
    functionName: FUNCTION_NAMES.ztlDomainA,
    timeoutSeconds: 10,
    project: "Zero Trust Lab",
  },
];

// The on-demand test env's own 4 GraphQL Lambdas (see infra/bin/app.ts's
// DEPLOY_TEST_ENV block) - no digest/price-check/warm-schedule/zero-trust-lab
// counterparts exist there (pantry-stack.ts gates those behind
// `if (!isTestEnv)`, and warm-schedule/zero-trust-lab were never part of
// what the test env exists to validate - see TEST_FUNCTION_NAMES's doc
// comment). Dashboard-only for this env, no alarms/SNS/toggle - see the
// class doc comment for why.
const TEST_FUNCTIONS: MonitoredFunction[] = [
  {
    id: "Portfolio",
    functionName: TEST_FUNCTION_NAMES.portfolio,
    timeoutSeconds: 30,
    project: "Portfolio",
    emitsGraphqlOperations: true,
  },
  {
    id: "Pantry",
    functionName: TEST_FUNCTION_NAMES.pantry,
    timeoutSeconds: 30,
    project: "Pantry",
    emitsGraphqlOperations: true,
  },
  {
    id: "Imposter",
    functionName: TEST_FUNCTION_NAMES.imposter,
    timeoutSeconds: 15,
    project: "Games",
    emitsGraphqlOperations: true,
  },
  {
    id: "Supergraph",
    functionName: TEST_FUNCTION_NAMES.supergraph,
    timeoutSeconds: 30,
    project: "Supergraph",
  },
];

interface MonitoredTable {
  id: string;
  tableName: string;
  project: string;
}

const PROD_TABLES: MonitoredTable[] = [
  { id: "Resume", tableName: "resume", project: "Portfolio" },
  { id: "Pantry", tableName: "pantry", project: "Pantry" },
  { id: "Games", tableName: "games", project: "Games" },
  { id: "ZtlSessions", tableName: "ztl-sessions", project: "Zero Trust Lab" },
];

const TEST_TABLES: MonitoredTable[] = [
  { id: "Resume", tableName: "resume-test", project: "Portfolio" },
  { id: "Pantry", tableName: "pantry-test", project: "Pantry" },
  { id: "Games", tableName: "games-test", project: "Games" },
];

// Per-project accumulator built while walking MONITORED_FUNCTIONS/_TABLES
// once, then rendered into dashboard rows at the end - keeps the "what data
// does this project have" bookkeeping separate from the "how do we lay it
// out" widget-building step below.
interface ProjectData {
  alarms: cloudwatch.Alarm[];
  latencyMetrics: cloudwatch.IMetric[];
  invocationMetrics: cloudwatch.IMetric[];
  errorMetrics: cloudwatch.IMetric[];
  graphqlLogGroupNames: string[];
  table?: { tableName: string; table: dynamodb.ITable };
}

export interface MonitoringStackProps extends StackProps {
  // True only for the on-demand test env's own dashboard (see
  // infra/bin/app.ts) - dashboard-only, no alarms/SNS topic/alerts-toggle
  // Lambda, since those exist to page a human about *production* problems
  // and a disposable test env isn't one.
  isTestEnv?: boolean;
}

/**
 * Operational visibility across every Lambda/DynamoDB table in one
 * environment (prod, or - with `isTestEnv: true` - the on-demand test env):
 * per-project rows on a CloudWatch Dashboard with a compact alarm-status
 * widget, a latency (p50/p99) line graph, bar graphs for invocation/error
 * counts (bar reads far better than a line for sparse, spiky event counts -
 * see shared/alarms.ts's Errors/Throttles alarms for the same "counts, not
 * trends" framing), a GraphQL-operations-by-name breakdown (via CloudWatch
 * Logs Insights against the EMF lines api-shared/operation-metrics.ts
 * writes - the actual operation names are unbounded/runtime-only, e.g.
 * AI-generated queries mint a fresh name every time, so a Logs Insights
 * `stats ... by operationName` query is the only way to group them without
 * knowing every name ahead of synth time), and each table's consumed
 * capacity/throttled requests.
 *
 * Prod-only pieces (alarms, the SNS topic, AlertsSettingsFunction) are
 * deliberately its own stack, same reasoning as ProvisionedConcurrencyStack:
 * monitoring is a cross-cutting operational concern that doesn't belong to
 * any one producing stack, and importing every target by plain name means
 * this stack can deploy in any order relative to the stacks that create
 * them.
 */
export class MonitoringStack extends Stack {
  constructor(scope: Construct, id: string, props?: MonitoringStackProps) {
    super(scope, id, props);

    const isTestEnv = props?.isTestEnv ?? false;
    const monitoredFunctions = isTestEnv ? TEST_FUNCTIONS : PROD_FUNCTIONS;
    const monitoredTables = isTestEnv ? TEST_TABLES : PROD_TABLES;

    let alarmTopic: sns.Topic | undefined;
    if (!isTestEnv) {
      alarmTopic = new sns.Topic(this, "AlarmsTopic", {
        topicName: "petertran-au-alarms",
        displayName: "petertran.au alarms",
      });
      alarmTopic.addSubscription(new subscriptions.EmailSubscription(ALARM_EMAIL));
    }

    const projects = new Map<string, ProjectData>();
    function dataFor(project: string): ProjectData {
      let data = projects.get(project);
      if (!data) {
        data = {
          alarms: [],
          latencyMetrics: [],
          invocationMetrics: [],
          errorMetrics: [],
          graphqlLogGroupNames: [],
        };
        projects.set(project, data);
      }

      return data;
    }

    for (const target of monitoredFunctions) {
      const fn = lambda.Function.fromFunctionName(this, `${target.id}Fn`, target.functionName);
      const data = dataFor(target.project);

      if (alarmTopic) {
        data.alarms.push(
          ...createLambdaAlarms(this, target.id, {
            fn,
            functionName: target.functionName,
            alarmTopic,
            timeoutSeconds: target.timeoutSeconds,
          })
        );
      }

      data.latencyMetrics.push(
        fn.metricDuration({ statistic: "p50", label: `${target.functionName} p50` }),
        fn.metricDuration({ statistic: "p99", label: `${target.functionName} p99` })
      );
      data.invocationMetrics.push(fn.metricInvocations({ label: target.functionName }));
      data.errorMetrics.push(
        fn.metricErrors({ label: `${target.functionName} errors` }),
        fn.metricThrottles({ label: `${target.functionName} throttles` })
      );

      if (target.emitsGraphqlOperations) {
        data.graphqlLogGroupNames.push(`/aws/lambda/${target.functionName}`);
      }
    }

    for (const target of monitoredTables) {
      const table = dynamodb.Table.fromTableName(this, `${target.id}Table`, target.tableName);
      dataFor(target.project).table = { tableName: target.tableName, table };
    }

    // Backs the Settings page's "email me when an alarm fires" toggle - real
    // AWS state, not a per-browser preference, since it mutes/unmutes the
    // one shared alarm subscription for every visitor to the settings page,
    // same reasoning as ProvisionedConcurrencyStack's warm-schedule toggle
    // not being a localStorage preference either. Lives in this stack (not
    // its own) since it only ever touches alarmTopic's own subscription -
    // no reason to split it out the way warm-schedule split from its
    // producing stacks, since there's nothing cross-cutting about it. Prod
    // only, same as the topic/alarms it manages.
    if (alarmTopic) {
      const alertsSettingsFn = new lambda.Function(this, "AlertsSettingsFunction", {
        functionName: FUNCTION_NAMES.alertsSettings,
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "alerts-settings/handler.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "../../api/dist")),
        memorySize: 128,
        timeout: Duration.seconds(10),
        environment: {
          ALARM_TOPIC_ARN: alarmTopic.topicArn,
          ALARM_EMAIL,
        },
        tracing: lambda.Tracing.ACTIVE,
      });
      alertsSettingsFn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["sns:ListSubscriptionsByTopic"],
          resources: [alarmTopic.topicArn],
        })
      );
      alertsSettingsFn.addToRolePolicy(
        new iam.PolicyStatement({
          // `*`, not `${alarmTopic.topicArn}:*` - tried the scoped wildcard
          // first (subscription ARNs are the topic ARN with a UUID suffix,
          // `<topicArn>:<uuid>`, not known until the subscription actually
          // exists), but confirmed live (via iam:SimulatePrincipalPolicy
          // against the real deployed role, and against the real
          // subscription ARN, cross-checked with the real Lambda's own
          // AccessDenied logs) that AWS's IAM engine does not match a
          // `topicArn:*` pattern against a real `topicArn:<uuid>`
          // subscription ARN for these two actions - same "AWS API with no
          // usable resource-level ARN scoping" category as the
          // CloudWatch/X-Ray/Cost Explorer grant in site-stack.ts, just
          // discovered empirically rather than up front.
          actions: ["sns:GetSubscriptionAttributes", "sns:SetSubscriptionAttributes"],
          resources: ["*"],
        })
      );
    }

    const dashboard = new cloudwatch.Dashboard(this, "Dashboard", {
      dashboardName: isTestEnv ? "petertran-au-test" : "petertran-au",
    });

    for (const [project, data] of projects) {
      dashboard.addWidgets(new cloudwatch.TextWidget({ markdown: `## ${project}`, width: 24, height: 1 }));

      // Compact - a whole row per alarm (the old layout) badly overstated
      // how much space an AlarmStatusWidget actually needs; it renders as a
      // dense grid, not a one-alarm-per-line list. Skipped entirely (and
      // its width redistributed to the graphs) when there's nothing to show
      // - the test-env dashboard never has alarms at all.
      const metricsRow: cloudwatch.IWidget[] = [];
      if (data.alarms.length > 0) {
        metricsRow.push(
          new cloudwatch.AlarmStatusWidget({ title: "Alarms", alarms: data.alarms, width: 6, height: 6 })
        );
      }

      const graphWidth = data.alarms.length > 0 ? 6 : 8;

      metricsRow.push(
        new cloudwatch.GraphWidget({
          title: "Latency (p50 / p99)",
          view: cloudwatch.GraphWidgetView.TIME_SERIES,
          left: data.latencyMetrics,
          leftYAxis: { label: "ms", showUnits: false },
          width: graphWidth,
          height: 6,
        }),
        // Bar, not line - a low-traffic personal project's invocation/error
        // counts are sparse and spiky, which reads as a flat, unreadable
        // line hugging zero with the occasional spike. Bars make individual
        // events visible at a glance instead.
        new cloudwatch.GraphWidget({
          title: "Invocations",
          view: cloudwatch.GraphWidgetView.BAR,
          left: data.invocationMetrics,
          width: graphWidth,
          height: 6,
        }),
        new cloudwatch.GraphWidget({
          title: "Errors & throttles",
          view: cloudwatch.GraphWidgetView.BAR,
          left: data.errorMetrics,
          width: graphWidth,
          height: 6,
        })
      );
      dashboard.addWidgets(...metricsRow);

      const detailRow: cloudwatch.IWidget[] = [];
      if (data.graphqlLogGroupNames.length > 0) {
        detailRow.push(
          new cloudwatch.LogQueryWidget({
            title: "GraphQL operations by name",
            logGroupNames: data.graphqlLogGroupNames,
            view: cloudwatch.LogQueryVisualizationType.BAR,
            queryLines: [
              "filter ispresent(OperationCount) and ispresent(operationName)",
              "stats sum(OperationCount) as count by operationName",
              "sort count desc",
              "limit 10",
            ],
            width: data.table ? 12 : 24,
            height: 6,
          })
        );
      }
      if (data.table) {
        detailRow.push(
          new cloudwatch.GraphWidget({
            title: `${data.table.tableName} table`,
            left: [
              data.table.table.metricConsumedReadCapacityUnits(),
              data.table.table.metricConsumedWriteCapacityUnits(),
            ],
            right: [data.table.table.metricThrottledRequestsForOperations()],
            width: data.graphqlLogGroupNames.length > 0 ? 12 : 24,
            height: 6,
          })
        );
      }
      if (detailRow.length > 0) dashboard.addWidgets(...detailRow);
    }
  }
}
