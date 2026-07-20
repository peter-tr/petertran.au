import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("aws-xray-sdk-core", () => ({
  getSegment: vi.fn(),
  captureAWSv3Client: vi.fn((client: unknown) => ({ __captured: client })),
}));

import * as AWSXRay from "aws-xray-sdk-core";
import { ANTHROPIC_API_SEGMENT_NAME, captureAwsClient, traced } from "./xray";

const mockedGetSegment = vi.mocked(AWSXRay.getSegment);
const mockedCaptureAWSv3Client = vi.mocked(AWSXRay.captureAWSv3Client);

describe("traced", () => {
  const originalFnName = process.env.AWS_LAMBDA_FUNCTION_NAME;

  beforeEach(() => {
    mockedGetSegment.mockReset();
    mockedCaptureAWSv3Client.mockClear();
  });

  afterEach(() => {
    if (originalFnName === undefined) {
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    } else {
      process.env.AWS_LAMBDA_FUNCTION_NAME = originalFnName;
    }
  });

  it("calls fn() directly and returns its value when not running in Lambda", async () => {
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;

    const fn = vi.fn().mockResolvedValue("result");

    const result = await traced("segment-name", fn);

    expect(result).toBe("result");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockedGetSegment).not.toHaveBeenCalled();
  });

  it("calls fn() directly when running in Lambda but no ambient segment is available", async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "my-function";
    mockedGetSegment.mockReturnValue(undefined);

    const fn = vi.fn().mockResolvedValue("no-segment-result");

    const result = await traced("segment-name", fn);

    expect(result).toBe("no-segment-result");
    expect(mockedGetSegment).toHaveBeenCalledTimes(1);
  });

  it("wraps fn() in a subsegment created from an explicitly passed parent segment", async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "my-function";

    const subsegment = { close: vi.fn() };
    const parent = { addNewSubsegment: vi.fn().mockReturnValue(subsegment) };
    const fn = vi.fn().mockResolvedValue(42);

    const result = await traced("my-segment", fn, parent as never);

    expect(result).toBe(42);
    // Explicitly passed parent bypasses the ambient AWSXRay.getSegment() lookup entirely.
    expect(mockedGetSegment).not.toHaveBeenCalled();
    expect(parent.addNewSubsegment).toHaveBeenCalledWith("my-segment");
    expect(subsegment.close).toHaveBeenCalledWith();
  });

  it("falls back to the ambient segment via AWSXRay.getSegment() when no parent is passed", async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "my-function";

    const subsegment = { close: vi.fn() };
    const ambientParent = { addNewSubsegment: vi.fn().mockReturnValue(subsegment) };
    mockedGetSegment.mockReturnValue(ambientParent as never);

    const fn = vi.fn().mockResolvedValue("ok");

    await traced("ambient-segment", fn);

    expect(mockedGetSegment).toHaveBeenCalledTimes(1);
    expect(ambientParent.addNewSubsegment).toHaveBeenCalledWith("ambient-segment");
  });

  it("closes the subsegment with the error and rethrows when fn() rejects", async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "my-function";

    const subsegment = { close: vi.fn() };
    const parent = { addNewSubsegment: vi.fn().mockReturnValue(subsegment) };
    const failure = new Error("boom");
    const fn = vi.fn().mockRejectedValue(failure);

    await expect(traced("failing-segment", fn, parent as never)).rejects.toThrow("boom");
    expect(subsegment.close).toHaveBeenCalledWith(failure);
  });

  it("closes the subsegment with undefined when fn() throws a non-Error value", async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "my-function";

    const subsegment = { close: vi.fn() };
    const parent = { addNewSubsegment: vi.fn().mockReturnValue(subsegment) };
    const fn = vi.fn().mockRejectedValue("string failure");

    await expect(traced("failing-segment", fn, parent as never)).rejects.toBe("string failure");
    expect(subsegment.close).toHaveBeenCalledWith(undefined);
  });
});

describe("captureAwsClient", () => {
  const originalFnName = process.env.AWS_LAMBDA_FUNCTION_NAME;

  beforeEach(() => {
    mockedCaptureAWSv3Client.mockClear();
  });

  afterEach(() => {
    if (originalFnName === undefined) {
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    } else {
      process.env.AWS_LAMBDA_FUNCTION_NAME = originalFnName;
    }
  });

  it("returns the client unchanged when not running in Lambda (no-op for local dev)", () => {
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;

    const client = { fake: "client" };

    const result = captureAwsClient(client as never);

    expect(result).toBe(client);
    expect(mockedCaptureAWSv3Client).not.toHaveBeenCalled();
  });

  it("wraps the client via AWSXRay.captureAWSv3Client when running in Lambda", () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "my-function";

    const client = { fake: "client" };

    const result = captureAwsClient(client as never);

    expect(mockedCaptureAWSv3Client).toHaveBeenCalledWith(client);
    expect(result).toEqual({ __captured: client });
  });
});

describe("ANTHROPIC_API_SEGMENT_NAME", () => {
  it("is a stable, shared subsegment name", () => {
    expect(ANTHROPIC_API_SEGMENT_NAME).toBe("Anthropic API");
  });
});
