import { Duration } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cw_actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

export interface LambdaAlarmsProps {
  fn: lambda.IFunction;
  // Plain string, not `fn.functionName` - on a Lambda imported via
  // `fromFunctionName` (every caller here does, per FUNCTION_NAMES's doc
  // comment), that getter returns a CloudFormation token, not the literal
  // name, so building an AlarmName/description off it would bury the real
  // name inside an Fn::Join in the synthesized template instead of reading
  // as plain text.
  functionName: string;
  alarmTopic: sns.ITopic;
  // The Lambda's own configured timeout, in seconds - used to size the p99
  // duration alarm relative to how close it's actually running to timing
  // out. Passed explicitly because `fn` (imported by name) doesn't carry
  // the real function's configuration.
  timeoutSeconds: number;
}

/**
 * Errors, Throttles, and p99 Duration alarms for one Lambda, all wired to
 * the same SNS topic. Errors/Throttles alarm on a single 5-minute breach -
 * these are low-traffic personal-project functions, so even one occurrence
 * is worth a look. Duration instead requires 2 of the last 3 5-minute
 * windows to breach 80% of the function's timeout before firing, since a
 * single slow cold start is expected/noisy on Lambdas that aren't kept warm
 * around the clock (see docs/warmup-and-provisioned-concurrency.md) and
 * shouldn't page anyone by itself.
 */
export function createLambdaAlarms(
  scope: Construct,
  idPrefix: string,
  props: LambdaAlarmsProps
): cloudwatch.Alarm[] {
  const { fn, functionName, alarmTopic, timeoutSeconds } = props;
  const action = new cw_actions.SnsAction(alarmTopic);

  const errorsAlarm = new cloudwatch.Alarm(scope, `${idPrefix}ErrorsAlarm`, {
    alarmName: `${functionName}-errors`,
    alarmDescription: `${functionName} returned at least one error in a 5-minute window`,
    metric: fn.metricErrors({ period: Duration.minutes(5), statistic: "sum" }),
    threshold: 1,
    evaluationPeriods: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });
  errorsAlarm.addAlarmAction(action);

  const throttlesAlarm = new cloudwatch.Alarm(scope, `${idPrefix}ThrottlesAlarm`, {
    alarmName: `${functionName}-throttles`,
    alarmDescription: `${functionName} was throttled at least once in a 5-minute window`,
    metric: fn.metricThrottles({ period: Duration.minutes(5), statistic: "sum" }),
    threshold: 1,
    evaluationPeriods: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });
  throttlesAlarm.addAlarmAction(action);

  const durationAlarm = new cloudwatch.Alarm(scope, `${idPrefix}DurationAlarm`, {
    alarmName: `${functionName}-duration-p99`,
    alarmDescription:
      `${functionName}'s p99 duration stayed at or above 80% of its ` +
      `${timeoutSeconds}s timeout for 2 of the last 3 5-minute windows`,
    metric: fn.metricDuration({ period: Duration.minutes(5), statistic: "p99" }),
    threshold: timeoutSeconds * 1000 * 0.8,
    evaluationPeriods: 3,
    datapointsToAlarm: 2,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });
  durationAlarm.addAlarmAction(action);

  return [errorsAlarm, throttlesAlarm, durationAlarm];
}
