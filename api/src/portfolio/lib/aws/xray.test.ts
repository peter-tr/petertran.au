import { XRayClient, BatchGetTracesCommand } from "@aws-sdk/client-xray";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTraceBreakdown } from "./xray";

const xrayMock = mockClient(XRayClient);

function segmentDoc(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    name: "work",
    start_time: 1000,
    end_time: 1001,
    ...overrides,
  });
}

// getTraceBreakdown retries (via real setTimeout) whenever it sees <=1
// segment, so every case below must run under fake timers and flush both
// retry delays - otherwise a scenario that naturally yields 0 or 1 segments
// (the "no traces"/"no segments" cases included) would hang waiting on a
// real timer that fake-timers never advances on its own.
async function runAndFlush(traceId: string) {
  const promise = getTraceBreakdown(traceId);
  await vi.advanceTimersByTimeAsync(700);
  await vi.advanceTimersByTimeAsync(1500);

  return promise;
}

describe("getTraceBreakdown", () => {
  beforeEach(() => {
    xrayMock.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    xrayMock.restore();
    vi.useRealTimers();
  });

  it("returns [] when there are no traces", async () => {
    xrayMock.on(BatchGetTracesCommand).resolves({ Traces: [] });

    const result = await runAndFlush("trace-1");
    expect(result).toEqual([]);
  });

  it("returns [] when the trace has no segments", async () => {
    xrayMock.on(BatchGetTracesCommand).resolves({ Traces: [{ Id: "trace-1", Segments: [] }] });

    const result = await runAndFlush("trace-1");
    expect(result).toEqual([]);
  });

  it("filters out segments with no parseable Document", async () => {
    xrayMock.on(BatchGetTracesCommand).resolves({
      Traces: [{ Id: "trace-1", Segments: [{ Id: "s1" }] }],
    });

    const result = await runAndFlush("trace-1");
    expect(result).toEqual([]);
  });

  it("computes offsets/durations relative to the earliest real segment and excludes inferred ones", async () => {
    xrayMock.on(BatchGetTracesCommand).resolves({
      Traces: [
        {
          Id: "trace-1",
          Segments: [
            {
              Document: segmentDoc({
                name: "handler",
                start_time: 100,
                end_time: 100.5,
                subsegments: [
                  { name: "DynamoDB", start_time: 100.1, end_time: 100.2 },
                  { name: "InferredThing", start_time: 100.1, end_time: 100.15, inferred: true },
                ],
              }),
            },
          ],
        },
      ],
    });

    // More than one real segment lands on the first attempt, so no retries needed
    // (runAndFlush's timer advances are simply no-ops here).
    const result = await runAndFlush("trace-1");

    expect(result).toEqual([
      { name: "handler", startOffsetMs: 0, durationMs: 500 },
      { name: "DynamoDB", startOffsetMs: 100, durationMs: 100 },
    ]);
  });

  it('maps AWS::Lambda-origin segments to "Lambda" and dedupes to the earliest one', async () => {
    xrayMock.on(BatchGetTracesCommand).resolves({
      Traces: [
        {
          Id: "trace-1",
          Segments: [
            { Document: segmentDoc({ name: "AWS::Lambda", origin: "AWS::Lambda", start_time: 100, end_time: 110 }) },
            {
              Document: segmentDoc({
                name: "our-handler-segment",
                origin: "AWS::Lambda::Function",
                start_time: 100.05,
                end_time: 109.9,
                subsegments: [{ name: "Anthropic API", start_time: 101, end_time: 102 }],
              }),
            },
          ],
        },
      ],
    });

    const result = await runAndFlush("trace-1");

    const lambdaEntries = result.filter((s) => s.name === "Lambda");
    expect(lambdaEntries).toHaveLength(1);
    // Earliest Lambda-ish segment (start_time 100) wins.
    expect(lambdaEntries[0]).toEqual({ name: "Lambda", startOffsetMs: 0, durationMs: 10000 });
    expect(result.some((s) => s.name === "Anthropic API")).toBe(true);
  });

  it("retries up to twice (700ms then 1500ms) when only a single segment is found, then returns what it gets", async () => {
    xrayMock
      .on(BatchGetTracesCommand)
      .resolvesOnce({ Traces: [{ Id: "trace-1", Segments: [{ Document: segmentDoc({ name: "Lambda", origin: "AWS::Lambda" }) }] }] })
      .resolvesOnce({ Traces: [{ Id: "trace-1", Segments: [{ Document: segmentDoc({ name: "Lambda", origin: "AWS::Lambda" }) }] }] })
      .resolves({
        Traces: [
          {
            Id: "trace-1",
            Segments: [
              {
                Document: segmentDoc({
                  name: "our-handler-segment",
                  origin: "AWS::Lambda::Function",
                  subsegments: [{ name: "DynamoDB", start_time: 1000.1, end_time: 1000.2 }],
                }),
              },
            ],
          },
        ],
      });

    const promise = getTraceBreakdown("trace-1");
    await vi.advanceTimersByTimeAsync(700);
    await vi.advanceTimersByTimeAsync(1500);

    const result = await promise;

    expect(xrayMock.calls()).toHaveLength(3);
    expect(result.some((s) => s.name === "DynamoDB")).toBe(true);
  });

  it("gives up after two retries and returns the single segment it has", async () => {
    xrayMock.on(BatchGetTracesCommand).resolves({
      Traces: [{ Id: "trace-1", Segments: [{ Document: segmentDoc({ name: "Lambda", origin: "AWS::Lambda" }) }] }],
    });

    const promise = getTraceBreakdown("trace-1");
    await vi.advanceTimersByTimeAsync(700);
    await vi.advanceTimersByTimeAsync(1500);

    const result = await promise;

    expect(xrayMock.calls()).toHaveLength(3);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Lambda");
  });
});
