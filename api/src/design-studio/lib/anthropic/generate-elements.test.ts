import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSettingsRecord, DesignElementRecord } from "../design";

const anthropicMessagesParse = vi.fn();
const anthropicMessagesCreate = vi.fn();
const bedrockMessagesParse = vi.fn();
const getAnthropicClient = vi.fn(async () => ({
  messages: { parse: anthropicMessagesParse, create: anthropicMessagesCreate },
}));
const getAnthropicBedrockClient = vi.fn(() => ({ messages: { parse: bedrockMessagesParse } }));
const assertAiNotRateLimited = vi.fn<(ip: string | undefined) => Promise<void>>(async () => undefined);
const gatherSupergraphContext = vi.fn<() => Promise<string | null>>(async () => null);

vi.mock("api-shared/anthropic-client", () => ({
  getAnthropicClient: () => getAnthropicClient(),
}));
vi.mock("api-shared/anthropic-bedrock-client", () => ({
  getAnthropicBedrockClient: () => getAnthropicBedrockClient(),
}));
vi.mock("../util/ai-rate-limit", () => ({
  assertAiNotRateLimited: (ip: string | undefined) => assertAiNotRateLimited(ip),
}));
vi.mock("./supergraph-tool", () => ({
  gatherSupergraphContext: (...args: unknown[]) => gatherSupergraphContext(...(args as [])),
}));

const { generateDesignElements } = await import("./generate-elements");

const ANTHROPIC_HAIKU: AiSettingsRecord = {
  provider: "ANTHROPIC",
  modelTier: "HAIKU",
  allowSupergraphQuery: false,
};
const ANTHROPIC_SONNET: AiSettingsRecord = {
  provider: "ANTHROPIC",
  modelTier: "SONNET",
  allowSupergraphQuery: false,
};
const BEDROCK_HAIKU: AiSettingsRecord = {
  provider: "BEDROCK",
  modelTier: "HAIKU",
  allowSupergraphQuery: false,
};
const BEDROCK_SONNET: AiSettingsRecord = {
  provider: "BEDROCK",
  modelTier: "SONNET",
  allowSupergraphQuery: false,
};

function rawElement(overrides: Record<string, unknown> = {}) {
  return {
    type: "RECTANGLE",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    fill: "#111111",
    stroke: "",
    strokeWidth: 0,
    text: null,
    fontFamily: null,
    fontSize: null,
    fontWeight: null,
    ...overrides,
  };
}

describe("generateDesignElements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an empty prompt without calling Anthropic", async () => {
    await expect(
      generateDesignElements("  ", 900, 600, undefined, "1.2.3.4", ANTHROPIC_HAIKU)
    ).rejects.toThrow("A prompt is required.");
    expect(getAnthropicClient).not.toHaveBeenCalled();
  });

  it("checks the rate limiter before calling Anthropic", async () => {
    assertAiNotRateLimited.mockRejectedValueOnce(
      new Error("Too many requests - please wait a moment and try again.")
    );

    await expect(
      generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4", ANTHROPIC_HAIKU)
    ).rejects.toThrow("Too many requests");
    expect(getAnthropicClient).not.toHaveBeenCalled();
  });

  it("assigns ids and sequential zIndex, ignoring whatever the model returned for them", async () => {
    anthropicMessagesParse.mockResolvedValueOnce({
      parsed_output: { elements: [rawElement({ x: 10 }), rawElement({ type: "TEXT", text: "Hi" })] },
    });

    const result = await generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4", ANTHROPIC_HAIKU);

    expect(result).toHaveLength(2);
    expect(result[0].zIndex).toBe(0);
    expect(result[1].zIndex).toBe(1);
    expect(result[0].id).not.toBe(result[1].id);
  });

  it("clamps out-of-bounds geometry to fit within the canvas", async () => {
    anthropicMessagesParse.mockResolvedValueOnce({
      parsed_output: {
        elements: [rawElement({ x: -50, y: 9999, width: 5000, height: 5000 })],
      },
    });

    const [el] = await generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4", ANTHROPIC_HAIKU);

    expect(el.x).toBeGreaterThanOrEqual(0);
    expect(el.y).toBeGreaterThanOrEqual(0);
    expect(el.x + el.width).toBeLessThanOrEqual(900);
    expect(el.y + el.height).toBeLessThanOrEqual(600);
  });

  it("defaults text-only fields to undefined for non-TEXT elements", async () => {
    anthropicMessagesParse.mockResolvedValueOnce({
      parsed_output: { elements: [rawElement({ type: "ELLIPSE" })] },
    });

    const [el] = await generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4", ANTHROPIC_HAIKU);

    expect(el.text).toBeUndefined();
    expect(el.fontFamily).toBeUndefined();
    expect(el.fontSize).toBeUndefined();
    expect(el.fontWeight).toBeUndefined();
  });

  it("backfills sensible defaults for TEXT elements missing font fields", async () => {
    anthropicMessagesParse.mockResolvedValueOnce({
      parsed_output: { elements: [rawElement({ type: "TEXT", text: "Hi", fontSize: 0 })] },
    });

    const [el] = await generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4", ANTHROPIC_HAIKU);

    expect(el.text).toBe("Hi");
    expect(el.fontFamily).toBe("IBM Plex Sans");
    expect(el.fontSize).toBe(20);
    expect(el.fontWeight).toBe(400);
  });

  it("throws when Claude returns no elements", async () => {
    anthropicMessagesParse.mockResolvedValueOnce({ parsed_output: { elements: [] } });

    await expect(
      generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4", ANTHROPIC_HAIKU)
    ).rejects.toThrow("didn't return a usable design");
  });

  it("caps the number of returned elements", async () => {
    anthropicMessagesParse.mockResolvedValueOnce({
      parsed_output: { elements: Array.from({ length: 20 }, () => rawElement()) },
    });

    const result = await generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4", ANTHROPIC_HAIKU);

    expect(result.length).toBeLessThanOrEqual(12);
  });

  it("includes the current draft in the prompt and mentions refinement in the system prompt when currentElements is given", async () => {
    anthropicMessagesParse.mockResolvedValueOnce({
      parsed_output: { elements: [rawElement()] },
    });

    const currentElements: DesignElementRecord[] = [
      {
        id: "a",
        type: "RECTANGLE",
        x: 0,
        y: 0,
        width: 900,
        height: 600,
        rotation: 0,
        zIndex: 0,
        fill: "#000",
        stroke: "",
        strokeWidth: 0,
      },
    ];

    await generateDesignElements("make it bigger", 900, 600, currentElements, "1.2.3.4", ANTHROPIC_HAIKU);

    const call = anthropicMessagesParse.mock.calls.at(-1)![0];
    expect(call.system).toContain("follow-up refinement");
    expect(call.messages[0].content).toContain("Current draft (JSON)");
    expect(call.messages[0].content).toContain("make it bigger");
  });

  it("does not mention refinement when currentElements is empty", async () => {
    anthropicMessagesParse.mockResolvedValueOnce({
      parsed_output: { elements: [rawElement()] },
    });

    await generateDesignElements("a poster", 900, 600, [], "1.2.3.4", ANTHROPIC_HAIKU);

    const call = anthropicMessagesParse.mock.calls.at(-1)![0];
    expect(call.system).not.toContain("follow-up refinement");
    expect(call.messages[0].content).toBe("a poster");
  });

  it("calls the direct Anthropic API with claude-haiku-4-5 and no thinking/effort for the ANTHROPIC/HAIKU tier", async () => {
    anthropicMessagesParse.mockResolvedValueOnce({ parsed_output: { elements: [rawElement()] } });

    await generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4", ANTHROPIC_HAIKU);

    expect(getAnthropicClient).toHaveBeenCalled();
    expect(getAnthropicBedrockClient).not.toHaveBeenCalled();

    const call = anthropicMessagesParse.mock.calls.at(-1)![0];
    expect(call.model).toBe("claude-haiku-4-5");
    expect(call.thinking).toBeUndefined();
    expect(call.output_config.effort).toBeUndefined();
  });

  it("rejects BEDROCK/HAIKU without calling Bedrock - that combination 400s (structured output unsupported for Haiku there)", async () => {
    await expect(
      generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4", BEDROCK_HAIKU)
    ).rejects.toThrow("Bedrock doesn't currently support");
    expect(getAnthropicBedrockClient).not.toHaveBeenCalled();
  });

  it("calls Bedrock with the sonnet inference profile for the BEDROCK/SONNET tier", async () => {
    bedrockMessagesParse.mockResolvedValueOnce({ parsed_output: { elements: [rawElement()] } });

    await generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4", BEDROCK_SONNET);

    expect(getAnthropicBedrockClient).toHaveBeenCalled();
    expect(getAnthropicClient).not.toHaveBeenCalled();

    const call = bedrockMessagesParse.mock.calls.at(-1)![0];
    expect(call.model).toBe("au.anthropic.claude-sonnet-4-6");
  });

  it("enables adaptive thinking and effort, with a higher max_tokens, for the SONNET tier", async () => {
    anthropicMessagesParse.mockResolvedValueOnce({ parsed_output: { elements: [rawElement()] } });

    await generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4", ANTHROPIC_SONNET);

    const call = anthropicMessagesParse.mock.calls.at(-1)![0];
    expect(call.model).toBe("claude-sonnet-4-6");
    expect(call.thinking).toEqual({ type: "adaptive" });
    expect(call.output_config.effort).toBe("low");
    expect(call.max_tokens).toBeGreaterThan(2048);
  });

  it("skips adaptive thinking/effort for a SONNET refinement, even though a fresh SONNET generation gets it", async () => {
    anthropicMessagesParse.mockResolvedValueOnce({ parsed_output: { elements: [rawElement()] } });

    const currentElements: DesignElementRecord[] = [
      {
        id: "a",
        type: "RECTANGLE",
        x: 0,
        y: 0,
        width: 900,
        height: 600,
        rotation: 0,
        zIndex: 0,
        fill: "#000",
        stroke: "",
        strokeWidth: 0,
      },
    ];

    await generateDesignElements(
      "make it bigger",
      900,
      600,
      currentElements,
      "1.2.3.4",
      ANTHROPIC_SONNET
    );

    const call = anthropicMessagesParse.mock.calls.at(-1)![0];
    expect(call.thinking).toBeUndefined();
    expect(call.output_config.effort).toBeUndefined();
    expect(call.max_tokens).toBe(2048);
  });

  it("passes a timeout under API Gateway's 29s hard limit as request options", async () => {
    anthropicMessagesParse.mockResolvedValueOnce({ parsed_output: { elements: [rawElement()] } });

    await generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4", ANTHROPIC_HAIKU);

    const options = anthropicMessagesParse.mock.calls.at(-1)![1];
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.timeout).toBeLessThan(29_000);
  });

  it("never gathers supergraph context when allowSupergraphQuery is false", async () => {
    anthropicMessagesParse.mockResolvedValueOnce({ parsed_output: { elements: [rawElement()] } });

    await generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4", ANTHROPIC_HAIKU);

    expect(gatherSupergraphContext).not.toHaveBeenCalled();
  });

  it("gathers supergraph context and appends it to the prompt when allowSupergraphQuery is true", async () => {
    gatherSupergraphContext.mockResolvedValueOnce("Real name: Peter Tran.");
    anthropicMessagesParse.mockResolvedValueOnce({ parsed_output: { elements: [rawElement()] } });

    const settings: AiSettingsRecord = {
      provider: "ANTHROPIC",
      modelTier: "HAIKU",
      allowSupergraphQuery: true,
    };
    await generateDesignElements("a header with my name", 900, 600, undefined, "1.2.3.4", settings);

    expect(gatherSupergraphContext).toHaveBeenCalledWith(
      expect.anything(),
      "claude-haiku-4-5",
      "a header with my name"
    );

    const call = anthropicMessagesParse.mock.calls.at(-1)![0];
    expect(call.messages[0].content).toContain("a header with my name");
    expect(call.messages[0].content).toContain("Real name: Peter Tran.");
  });

  it("still succeeds when gatherSupergraphContext throws", async () => {
    gatherSupergraphContext.mockRejectedValueOnce(new Error("supergraph unreachable"));
    anthropicMessagesParse.mockResolvedValueOnce({ parsed_output: { elements: [rawElement()] } });

    const settings: AiSettingsRecord = {
      provider: "ANTHROPIC",
      modelTier: "HAIKU",
      allowSupergraphQuery: true,
    };
    const result = await generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4", settings);

    expect(result).toHaveLength(1);

    const call = anthropicMessagesParse.mock.calls.at(-1)![0];
    expect(call.messages[0].content).toBe("a poster");
  });
});
