import { describe, expect, it } from "vitest";
import { buildDebugInfo } from "./debug-info";

describe("buildDebugInfo", () => {
  it("computes cost from input/output token pricing", () => {
    const info = buildDebugInfo({ input_tokens: 1_000_000, output_tokens: 0 }, 123);

    expect(info.costUsd).toBeCloseTo(1, 10);
    expect(info.durationMs).toBe(123);
  });

  it("weighs output tokens 5x input tokens", () => {
    const info = buildDebugInfo({ input_tokens: 0, output_tokens: 1_000_000 }, 0);

    expect(info.costUsd).toBeCloseTo(5, 10);
  });

  it("sums input and output cost", () => {
    const info = buildDebugInfo({ input_tokens: 2_000_000, output_tokens: 1_000_000 }, 0);

    // 2 * $1/MTok + 1 * $5/MTok = $7
    expect(info.costUsd).toBeCloseTo(7, 10);
  });

  it("defaults searchesUsed/fetchesUsed to 0 when server_tool_use is absent", () => {
    const info = buildDebugInfo({ input_tokens: 10, output_tokens: 10 }, 0);

    expect(info.searchesUsed).toBe(0);
    expect(info.fetchesUsed).toBe(0);
  });

  it("defaults searchesUsed/fetchesUsed to 0 when server_tool_use is null", () => {
    const info = buildDebugInfo({ input_tokens: 10, output_tokens: 10, server_tool_use: null }, 0);

    expect(info.searchesUsed).toBe(0);
    expect(info.fetchesUsed).toBe(0);
  });

  it("defaults individual missing counts to 0 while keeping the other", () => {
    const info = buildDebugInfo(
      { input_tokens: 10, output_tokens: 10, server_tool_use: { web_search_requests: 3 } },
      0
    );

    expect(info.searchesUsed).toBe(3);
    expect(info.fetchesUsed).toBe(0);
  });

  it("reads both counts when present", () => {
    const info = buildDebugInfo(
      {
        input_tokens: 10,
        output_tokens: 10,
        server_tool_use: { web_search_requests: 2, web_fetch_requests: 4 },
      },
      0
    );

    expect(info.searchesUsed).toBe(2);
    expect(info.fetchesUsed).toBe(4);
  });

  it("treats a null individual count as 0", () => {
    const info = buildDebugInfo(
      {
        input_tokens: 10,
        output_tokens: 10,
        server_tool_use: { web_search_requests: null, web_fetch_requests: null },
      },
      0
    );

    expect(info.searchesUsed).toBe(0);
    expect(info.fetchesUsed).toBe(0);
  });
});
