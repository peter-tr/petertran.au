import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { SchedulerClient, GetScheduleCommand, UpdateScheduleCommand } from "@aws-sdk/client-scheduler";
import { parseJsonBody } from "@shared/http";
import { isWarmupPing, type WarmupPing } from "@shared/warmup";

const scheduler = new SchedulerClient({});
// Every warmup schedule this toggle controls (portfolio, pantry, imposter,
// and zero-trust-lab's own Lambdas) - only ever flipped together, so reading
// the state of just the first one is enough to answer "is warmup on".
const SCHEDULE_NAMES = process.env.SCHEDULE_NAMES!.split(",");

async function getEnabled(): Promise<boolean> {
  const { State } = await scheduler.send(new GetScheduleCommand({ Name: SCHEDULE_NAMES[0] }));
  return State === "ENABLED";
}

// EventBridge Scheduler has no partial-patch "enable/disable" call - Update
// requires resending the full schedule definition, so each toggle re-fetches
// its own current definition first and only changes State.
async function setEnabled(enabled: boolean): Promise<void> {
  const state = enabled ? "ENABLED" : "DISABLED";

  await Promise.all(
    SCHEDULE_NAMES.map(async (name) => {
      const current = await scheduler.send(new GetScheduleCommand({ Name: name }));
      await scheduler.send(
        new UpdateScheduleCommand({
          Name: name,
          ScheduleExpression: current.ScheduleExpression,
          FlexibleTimeWindow: current.FlexibleTimeWindow,
          Target: current.Target,
          State: state,
        })
      );
    })
  );
}

export async function handler(
  event: APIGatewayProxyEventV2 | WarmupPing
): Promise<APIGatewayProxyStructuredResultV2> {
  if (isWarmupPing(event)) return { statusCode: 200, body: "warm" };

  if (event.requestContext.http.method === "POST") {
    const { enabled } = parseJsonBody<{ enabled?: boolean }>(event);
    if (typeof enabled !== "boolean") {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "enabled must be a boolean" }),
      };
    }
    await setEnabled(enabled);
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    };
  }

  const enabled = await getEnabled();
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  };
}
