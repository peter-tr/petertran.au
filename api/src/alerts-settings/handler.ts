import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  SNSClient,
  ListSubscriptionsByTopicCommand,
  GetSubscriptionAttributesCommand,
  SetSubscriptionAttributesCommand,
} from "@aws-sdk/client-sns";
import { parseJsonBody, corsHeaders } from "api-shared/http";

const sns = new SNSClient({});

const TOPIC_ARN = process.env.ALARM_TOPIC_ARN!;
const ALARM_EMAIL = process.env.ALARM_EMAIL!;

// Mutes the subscription in place rather than unsubscribing/resubscribing
// it - SNS emails a fresh "confirm subscription" link on every new
// subscribe, so unsubscribing to "turn alerts off" would force re-confirming
// by email just to turn them back on. A FilterPolicy that requires a message
// attribute CloudWatch Alarm's SNS action never sets means the subscription
// simply never matches while this is in place - the topic, alarms, and
// dashboard all keep working exactly as before, only the email stops.
const MUTE_FILTER_POLICY = JSON.stringify({ __alertsMuted__: ["true"] });
const NO_FILTER_POLICY = "{}";

async function findSubscriptionArn(): Promise<string | undefined> {
  const { Subscriptions } = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: TOPIC_ARN }));

  return Subscriptions?.find((s) => s.Protocol === "email" && s.Endpoint === ALARM_EMAIL)?.SubscriptionArn;
}

async function getEnabled(): Promise<boolean> {
  const subscriptionArn = await findSubscriptionArn();
  // Not found, or still awaiting the confirmation-link click SES/SNS emails
  // on first subscribe - either way there's nothing to mute yet, so alerts
  // are (as far as this can tell) on.
  if (!subscriptionArn || subscriptionArn === "PendingConfirmation") return true;

  const { Attributes } = await sns.send(
    new GetSubscriptionAttributesCommand({ SubscriptionArn: subscriptionArn })
  );

  return !Attributes?.FilterPolicy || Attributes.FilterPolicy === NO_FILTER_POLICY;
}

async function setEnabled(enabled: boolean): Promise<void> {
  const subscriptionArn = await findSubscriptionArn();
  if (!subscriptionArn || subscriptionArn === "PendingConfirmation") {
    throw new Error("alert email subscription not found or still pending confirmation");
  }

  await sns.send(
    new SetSubscriptionAttributesCommand({
      SubscriptionArn: subscriptionArn,
      AttributeName: "FilterPolicy",
      AttributeValue: enabled ? NO_FILTER_POLICY : MUTE_FILTER_POLICY,
    })
  );
}

// api-shared/http.ts's corsHeaders doc comment explains why this is needed
// at all: API Gateway REST API's defaultCorsPreflightOptions only answers
// the browser's OPTIONS preflight, not the actual GET/POST response coming
// back through a Lambda proxy integration - every handler behind it has to
// add Access-Control-Allow-Origin itself, same as warm-schedule/handler.ts.
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const result = await handleRequest(event);

  return { ...result, headers: { ...result.headers, ...corsHeaders(event.headers?.origin) } };
}

async function handleRequest(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === "POST") {
    const body = parseJsonBody<{ enabled?: unknown }>(event);
    if (typeof body.enabled !== "boolean") {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "enabled must be a boolean" }),
      };
    }

    try {
      await setEnabled(body.enabled);
    } catch (err) {
      return {
        statusCode: 409,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: err instanceof Error ? err.message : "couldn't update subscription" }),
      };
    }

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: body.enabled }),
    };
  }

  const enabled = await getEnabled();

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  };
}
