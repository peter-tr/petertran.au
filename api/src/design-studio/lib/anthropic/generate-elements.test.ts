import { describe, expect, it, vi } from "vitest";
import type { DesignElementRecord } from "../design";

const messagesParse = vi.fn();
const getAnthropicClient = vi.fn(async () => ({ messages: { parse: messagesParse } }));
const assertAiNotRateLimited = vi.fn<(ip: string | undefined) => Promise<void>>(async () => undefined);

vi.mock("api-shared/anthropic-client", () => ({
  getAnthropicClient: () => getAnthropicClient(),
}));
vi.mock("../util/ai-rate-limit", () => ({
  assertAiNotRateLimited: (ip: string | undefined) => assertAiNotRateLimited(ip),
}));

const { generateDesignElements } = await import("./generate-elements");

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
  it("rejects an empty prompt without calling Anthropic", async () => {
    await expect(generateDesignElements("  ", 900, 600, undefined, "1.2.3.4")).rejects.toThrow(
      "A prompt is required."
    );
    expect(getAnthropicClient).not.toHaveBeenCalled();
  });

  it("checks the rate limiter before calling Anthropic", async () => {
    assertAiNotRateLimited.mockRejectedValueOnce(
      new Error("Too many requests - please wait a moment and try again.")
    );

    await expect(generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4")).rejects.toThrow(
      "Too many requests"
    );
    expect(getAnthropicClient).not.toHaveBeenCalled();
  });

  it("assigns ids and sequential zIndex, ignoring whatever the model returned for them", async () => {
    messagesParse.mockResolvedValueOnce({
      parsed_output: { elements: [rawElement({ x: 10 }), rawElement({ type: "TEXT", text: "Hi" })] },
    });

    const result = await generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4");

    expect(result).toHaveLength(2);
    expect(result[0].zIndex).toBe(0);
    expect(result[1].zIndex).toBe(1);
    expect(result[0].id).not.toBe(result[1].id);
  });

  it("clamps out-of-bounds geometry to fit within the canvas", async () => {
    messagesParse.mockResolvedValueOnce({
      parsed_output: {
        elements: [rawElement({ x: -50, y: 9999, width: 5000, height: 5000 })],
      },
    });

    const [el] = await generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4");

    expect(el.x).toBeGreaterThanOrEqual(0);
    expect(el.y).toBeGreaterThanOrEqual(0);
    expect(el.x + el.width).toBeLessThanOrEqual(900);
    expect(el.y + el.height).toBeLessThanOrEqual(600);
  });

  it("defaults text-only fields to undefined for non-TEXT elements", async () => {
    messagesParse.mockResolvedValueOnce({
      parsed_output: { elements: [rawElement({ type: "ELLIPSE" })] },
    });

    const [el] = await generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4");

    expect(el.text).toBeUndefined();
    expect(el.fontFamily).toBeUndefined();
    expect(el.fontSize).toBeUndefined();
    expect(el.fontWeight).toBeUndefined();
  });

  it("backfills sensible defaults for TEXT elements missing font fields", async () => {
    messagesParse.mockResolvedValueOnce({
      parsed_output: { elements: [rawElement({ type: "TEXT", text: "Hi", fontSize: 0 })] },
    });

    const [el] = await generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4");

    expect(el.text).toBe("Hi");
    expect(el.fontFamily).toBe("IBM Plex Sans");
    expect(el.fontSize).toBe(20);
    expect(el.fontWeight).toBe(400);
  });

  it("throws when Claude returns no elements", async () => {
    messagesParse.mockResolvedValueOnce({ parsed_output: { elements: [] } });

    await expect(generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4")).rejects.toThrow(
      "didn't return a usable design"
    );
  });

  it("caps the number of returned elements", async () => {
    messagesParse.mockResolvedValueOnce({
      parsed_output: { elements: Array.from({ length: 20 }, () => rawElement()) },
    });

    const result = await generateDesignElements("a poster", 900, 600, undefined, "1.2.3.4");

    expect(result.length).toBeLessThanOrEqual(12);
  });

  it("includes the current draft in the prompt and mentions refinement in the system prompt when currentElements is given", async () => {
    messagesParse.mockResolvedValueOnce({
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

    await generateDesignElements("make it bigger", 900, 600, currentElements, "1.2.3.4");

    const call = messagesParse.mock.calls.at(-1)![0];
    expect(call.system).toContain("follow-up refinement");
    expect(call.messages[0].content).toContain("Current draft (JSON)");
    expect(call.messages[0].content).toContain("make it bigger");
  });

  it("does not mention refinement when currentElements is empty", async () => {
    messagesParse.mockResolvedValueOnce({
      parsed_output: { elements: [rawElement()] },
    });

    await generateDesignElements("a poster", 900, 600, [], "1.2.3.4");

    const call = messagesParse.mock.calls.at(-1)![0];
    expect(call.system).not.toContain("follow-up refinement");
    expect(call.messages[0].content).toBe("a poster");
  });
});
