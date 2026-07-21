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
import { FUNCTION_NAMES } from "./shared/function-names";

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
}

// Every prod Lambda across the independently-deployed projects (see
// CLAUDE.md's "api workspace structure"), imported here by plain name -
// not a live construct reference, same "no CloudFormation export lock-in"
// convention FUNCTION_NAMES's doc comment explains for
// ProvisionedConcurrencyStack/ApiGatewayStack. timeoutSeconds mirrors each
// function's actual configured `timeout` in its producing stack (kept in
// sync by hand - there's no live reference to read it from). Test-env
// counterparts are deliberately excluded: they're disposable and short-lived,
// so alarming on them would just be noise.
const MONITORED_FUNCTIONS: MonitoredFunction[] = [
  { id: "Portfolio", functionName: FUNCTION_NAMES.portfolio, timeoutSeconds: 30, project: "Portfolio" },
  { id: "Pantry", functionName: FUNCTION_NAMES.pantry, timeoutSeconds: 30, project: "Pantry" },
  { id: "PantryDigest", functionName: "pantry-digest", timeoutSeconds: 30, project: "Pantry" },
  { id: "PantryPriceCheck", functionName: "pantry-price-check", timeoutSeconds: 600, project: "Pantry" },
  { id: "Imposter", functionName: FUNCTION_NAMES.imposter, timeoutSeconds: 15, project: "Games" },
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

interface MonitoredTable {
  id: string;
  tableName: string;
  project: string;
}

const MONITORED_TABLES: MonitoredTable[] = [
  { id: "Resume", tableName: "resume", project: "Portfolio" },
  { id: "Pantry", tableName: "pantry", project: "Pantry" },
  { id: "Games", tableName: "games", project: "Games" },
  { id: "ZtlSessions", tableName: "ztl-sessions", project: "Zero Trust Lab" },
];

/**
 * Operational visibility across every prod Lambda/DynamoDB table: an SNS
 * topic that emails Peter directly, Errors/Throttles/Duration alarms per
 * Lambda wired to it (see shared/alarms.ts), and a single CloudWatch
 * Dashboard grouping Invocations/Errors/Duration/Throttles per Lambda and
 * consumed capacity/throttled requests per table by project. Deliberately
 * its own stack, same reasoning as ProvisionedConcurrencyStack: monitoring
 * is a cross-cutting operational concern that doesn't belong to any one
 * producing stack, and importing every target by plain name means this
 * stack can deploy in any order relative to the stacks that create them.
 */
export class MonitoringStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const alarmTopic = new sns.Topic(this, "AlarmsTopic", {
      topicName: "petertran-au-alarms",
      displayName: "petertran.au alarms",
    });
    alarmTopic.addSubscription(new subscriptions.EmailSubscription(ALARM_EMAIL));

    const allAlarms: cloudwatch.Alarm[] = [];
    const widgetsByProject = new Map<string, cloudwatch.IWidget[]>();

    for (const target of MONITORED_FUNCTIONS) {
      const fn = lambda.Function.fromFunctionName(this, `${target.id}Fn`, target.functionName);

      allAlarms.push(
        ...createLambdaAlarms(this, target.id, {
          fn,
          functionName: target.functionName,
          alarmTopic,
          timeoutSeconds: target.timeoutSeconds,
        })
      );

      const widget = new cloudwatch.GraphWidget({
        title: target.functionName,
        left: [fn.metricInvocations(), fn.metricErrors(), fn.metricThrottles()],
        right: [fn.metricDuration({ statistic: "p99" })],
        width: 8,
        height: 6,
      });
      widgetsByProject.set(target.project, [...(widgetsByProject.get(target.project) ?? []), widget]);
    }

    for (const target of MONITORED_TABLES) {
      const table = dynamodb.Table.fromTableName(this, `${target.id}Table`, target.tableName);

      const widget = new cloudwatch.GraphWidget({
        title: `${target.tableName} table`,
        left: [table.metricConsumedReadCapacityUnits(), table.metricConsumedWriteCapacityUnits()],
        right: [table.metricThrottledRequestsForOperations()],
        width: 8,
        height: 6,
      });
      widgetsByProject.set(target.project, [...(widgetsByProject.get(target.project) ?? []), widget]);
    }

    // Backs the Settings page's "email me when an alarm fires" toggle - real
    // AWS state, not a per-browser preference, since it mutes/unmutes the
    // one shared alarm subscription for every visitor to the settings page,
    // same reasoning as ProvisionedConcurrencyStack's warm-schedule toggle
    // not being a localStorage preference either. Lives in this stack (not
    // its own) since it only ever touches alarmTopic's own subscription -
    // no reason to split it out the way warm-schedule split from its
    // producing stacks, since there's nothing cross-cutting about it.
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
        // Subscription ARNs are the topic ARN with a UUID suffix
        // (`<topicArn>:<uuid>`), not known until the subscription is
        // actually created - the wildcard covers that without needing to
        // hardcode it.
        actions: ["sns:GetSubscriptionAttributes", "sns:SetSubscriptionAttributes"],
        resources: [`${alarmTopic.topicArn}:*`],
      })
    );

    const dashboard = new cloudwatch.Dashboard(this, "Dashboard", {
      dashboardName: "petertran-au",
    });
    dashboard.addWidgets(
      new cloudwatch.AlarmStatusWidget({
        title: "Alarm status",
        alarms: allAlarms,
        width: 24,
        height: Math.max(4, Math.ceil(allAlarms.length / 4)),
      })
    );
    for (const [project, widgets] of widgetsByProject) {
      dashboard.addWidgets(new cloudwatch.TextWidget({ markdown: `## ${project}`, width: 24, height: 1 }));
      dashboard.addWidgets(...widgets);
    }
  }
}
