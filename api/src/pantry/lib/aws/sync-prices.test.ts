import { mockClient } from "aws-sdk-client-mock";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { triggerPriceSync } from "./sync-prices";

const lambdaMock = mockClient(LambdaClient);

describe("triggerPriceSync", () => {
  const original = process.env.PRICE_CHECK_FUNCTION_NAME;

  beforeEach(() => {
    lambdaMock.reset();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.PRICE_CHECK_FUNCTION_NAME;
    else process.env.PRICE_CHECK_FUNCTION_NAME = original;
  });

  it("throws when PRICE_CHECK_FUNCTION_NAME is not configured", async () => {
    delete process.env.PRICE_CHECK_FUNCTION_NAME;

    await expect(triggerPriceSync("PANTRY")).rejects.toThrow("PRICE_CHECK_FUNCTION_NAME not configured.");
    expect(lambdaMock.calls()).toHaveLength(0);
  });

  it("fire-and-forget invokes the configured function with InvocationType Event and the pk payload", async () => {
    process.env.PRICE_CHECK_FUNCTION_NAME = "my-price-check-fn";
    lambdaMock.on(InvokeCommand).resolves({});

    await triggerPriceSync("USER#abc");

    expect(lambdaMock.calls()).toHaveLength(1);

    const input = lambdaMock.call(0).args[0].input as {
      FunctionName: string;
      InvocationType: string;
      Payload: string;
    };
    expect(input.FunctionName).toBe("my-price-check-fn");
    expect(input.InvocationType).toBe("Event");
    expect(JSON.parse(input.Payload)).toEqual({ pk: "USER#abc" });
  });

  it("propagates an error from the Lambda invoke", async () => {
    process.env.PRICE_CHECK_FUNCTION_NAME = "my-price-check-fn";
    lambdaMock.on(InvokeCommand).rejects(new Error("throttled"));

    await expect(triggerPriceSync("PANTRY")).rejects.toThrow("throttled");
  });
});
