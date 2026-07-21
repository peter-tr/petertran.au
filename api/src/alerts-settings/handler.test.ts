import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  SNSClient,
  ListSubscriptionsByTopicCommand,
  GetSubscriptionAttributesCommand,
  SetSubscriptionAttributesCommand,
} from "@aws-sdk/client-sns";

process.env.ALARM_TOPIC_ARN = "arn:aws:sns:ap-southeast-2:123456789012:petertran-au-alarms";
process.env.ALARM_EMAIL = "peter2002tran@outlook.com";

const { handler } = await import("./handler");
import type { APIGatewayProxyEvent } from "aws-lambda";

const snsMock = mockClient(SNSClient);

const SUBSCRIPTION_ARN =
  "arn:aws:sns:ap-southeast-2:123456789012:petertran-au-alarms:11111111-2222-3333-4444-555555555555";

function httpEvent(method: string, body?: unknown): APIGatewayProxyEvent {
  return {
    httpMethod: method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEvent;
}

beforeEach(() => {
  snsMock.reset();
  snsMock.on(ListSubscriptionsByTopicCommand).resolves({
    Subscriptions: [
      {
        Protocol: "email",
        Endpoint: "peter2002tran@outlook.com",
        SubscriptionArn: SUBSCRIPTION_ARN,
      },
    ],
  });
});

describe("alerts-settings handler - GET", () => {
  it("reports enabled when the subscription has no FilterPolicy", async () => {
    snsMock.on(GetSubscriptionAttributesCommand).resolves({ Attributes: {} });

    const result = await handler(httpEvent("GET"));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({ enabled: true });
  });

  it("reports disabled when the subscription has the mute FilterPolicy", async () => {
    snsMock.on(GetSubscriptionAttributesCommand).resolves({
      Attributes: { FilterPolicy: JSON.stringify({ __alertsMuted__: ["true"] }) },
    });

    const result = await handler(httpEvent("GET"));
    expect(JSON.parse(result.body as string)).toEqual({ enabled: false });
  });

  it("reports enabled when the subscription can't be found yet (e.g. still pending confirmation)", async () => {
    snsMock.on(ListSubscriptionsByTopicCommand).resolves({ Subscriptions: [] });

    const result = await handler(httpEvent("GET"));
    expect(JSON.parse(result.body as string)).toEqual({ enabled: true });
    expect(snsMock.commandCalls(GetSubscriptionAttributesCommand)).toHaveLength(0);
  });
});

describe("alerts-settings handler - POST", () => {
  it("with enabled:false sets the mute FilterPolicy on the subscription", async () => {
    snsMock.on(SetSubscriptionAttributesCommand).resolves({});

    const result = await handler(httpEvent("POST", { enabled: false }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({ enabled: false });

    const calls = snsMock.commandCalls(SetSubscriptionAttributesCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({
      SubscriptionArn: SUBSCRIPTION_ARN,
      AttributeName: "FilterPolicy",
      AttributeValue: JSON.stringify({ __alertsMuted__: ["true"] }),
    });
  });

  it("with enabled:true clears the FilterPolicy on the subscription", async () => {
    snsMock.on(SetSubscriptionAttributesCommand).resolves({});

    const result = await handler(httpEvent("POST", { enabled: true }));
    expect(result.statusCode).toBe(200);

    const calls = snsMock.commandCalls(SetSubscriptionAttributesCommand);
    expect(calls[0].args[0].input.AttributeValue).toBe("{}");
  });

  it("with a non-boolean enabled returns 400", async () => {
    const result = await handler(httpEvent("POST", { enabled: "yes" }));
    expect(result.statusCode).toBe(400);
    expect(snsMock.commandCalls(SetSubscriptionAttributesCommand)).toHaveLength(0);
  });

  it("returns 409 when the subscription can't be found (e.g. still pending confirmation)", async () => {
    snsMock.on(ListSubscriptionsByTopicCommand).resolves({ Subscriptions: [] });

    const result = await handler(httpEvent("POST", { enabled: false }));
    expect(result.statusCode).toBe(409);
  });
});
