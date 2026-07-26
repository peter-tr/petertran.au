import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSpan, mockStartActiveSpan } = vi.hoisted(() => {
  const mockSpan = {
    recordException: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
  };
  const mockStartActiveSpan = vi.fn((_name: string, fn: (span: typeof mockSpan) => unknown) => fn(mockSpan));

  return { mockSpan, mockStartActiveSpan };
});

vi.mock("@opentelemetry/api", () => ({
  trace: { getTracer: vi.fn(() => ({ startActiveSpan: mockStartActiveSpan })) },
  SpanStatusCode: { ERROR: 2 },
}));

import { traceSpan } from "./tracing";

describe("traceSpan", () => {
  beforeEach(() => {
    mockSpan.recordException.mockReset();
    mockSpan.setStatus.mockReset();
    mockSpan.end.mockReset();
    mockStartActiveSpan.mockClear();
  });

  it("starts a span with the given name and returns fn()'s resolved value", async () => {
    const result = await traceSpan("rate-limit-check", async () => "ok");

    expect(result).toBe("ok");
    expect(mockStartActiveSpan).toHaveBeenCalledWith("rate-limit-check", expect.any(Function));
  });

  it("ends the span after fn() resolves", async () => {
    await traceSpan("some-work", async () => undefined);

    expect(mockSpan.end).toHaveBeenCalledTimes(1);
    expect(mockSpan.recordException).not.toHaveBeenCalled();
  });

  it("records the exception, marks the span as errored, ends it, and rethrows when fn() rejects", async () => {
    const err = new Error("boom");

    await expect(traceSpan("some-work", () => Promise.reject(err))).rejects.toBe(err);

    expect(mockSpan.recordException).toHaveBeenCalledWith(err);
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 2 });
    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });
});
