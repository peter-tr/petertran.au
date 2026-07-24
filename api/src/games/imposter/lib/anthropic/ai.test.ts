import { beforeEach, describe, expect, it, vi } from "vitest";

const parse = vi.fn();
const getAnthropicClient = vi.fn(async () => ({ messages: { parse } }));
const assertNotRateLimited = vi.fn<(sourceIp: string | undefined) => Promise<void>>(async () => {});

// vi.mock calls are hoisted above imports by vitest's transform, so ai.ts
// (imported below) picks up these mocks instead of ever constructing a real
// Anthropic client, hitting DynamoDB for rate limiting, or making a network call.
vi.mock("api-shared/anthropic-client", () => ({
  getAnthropicClient: () => getAnthropicClient(),
}));
vi.mock("../util/rate-limit", () => ({
  assertNotRateLimited: (sourceIp: string | undefined) => assertNotRateLimited(sourceIp),
}));

import { generateAiWordPair } from "./ai";
import { WORD_CATEGORIES } from "../words";

function parsedOutput(overrides: Partial<{ category: string; civilian: string; imposter: string }> = {}) {
  return {
    parsed_output: { category: "Coffee drinks", civilian: "Latte", imposter: "Espresso", ...overrides },
  };
}

describe("generateAiWordPair", () => {
  beforeEach(() => {
    parse.mockReset();
    getAnthropicClient.mockClear();
    assertNotRateLimited.mockReset();
    assertNotRateLimited.mockResolvedValue(undefined);
  });

  it("checks the rate limiter before ever calling the Anthropic API", async () => {
    assertNotRateLimited.mockRejectedValueOnce(new Error("slow down"));

    await expect(generateAiWordPair(undefined, "NORMAL", "1.2.3.4")).rejects.toThrow("slow down");
    expect(parse).not.toHaveBeenCalled();
  });

  it("passes the sourceIp through to the rate limiter", async () => {
    parse.mockResolvedValueOnce(parsedOutput());
    await generateAiWordPair(undefined, "NORMAL", "9.9.9.9");
    expect(assertNotRateLimited).toHaveBeenCalledWith("9.9.9.9");
  });

  it("returns a good first-attempt result as-is", async () => {
    parse.mockResolvedValueOnce(parsedOutput());

    const result = await generateAiWordPair(undefined, "NORMAL", undefined);

    expect(result).toEqual({ category: "Coffee drinks", civilian: "Latte", imposter: "Espresso" });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("trims whitespace from the returned civilian/imposter words", async () => {
    parse.mockResolvedValueOnce(parsedOutput({ civilian: "  Latte  ", imposter: " Espresso " }));

    const result = await generateAiWordPair(undefined, "NORMAL", undefined);

    expect(result.civilian).toBe("Latte");
    expect(result.imposter).toBe("Espresso");
  });

  it("skips a response missing required fields and retries", async () => {
    parse.mockResolvedValueOnce({ parsed_output: null });
    parse.mockResolvedValueOnce(parsedOutput());

    const result = await generateAiWordPair(undefined, "NORMAL", undefined);

    expect(parse).toHaveBeenCalledTimes(2);
    expect(result.civilian).toBe("Latte");
  });

  it("never accepts identical civilian/imposter words, even case-insensitively, and retries", async () => {
    parse.mockResolvedValueOnce(parsedOutput({ civilian: "Latte", imposter: "latte" }));
    parse.mockResolvedValueOnce(parsedOutput());

    const result = await generateAiWordPair(undefined, "NORMAL", undefined);

    expect(parse).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ category: "Coffee drinks", civilian: "Latte", imposter: "Espresso" });
  });

  it("falls back to a built-in word pair if every attempt is degenerate (identical words)", async () => {
    parse.mockResolvedValue(parsedOutput({ civilian: "Latte", imposter: "latte" }));

    const result = await generateAiWordPair(undefined, "HARD", undefined);

    expect(parse).toHaveBeenCalledTimes(3); // MAX_ATTEMPTS

    const allHardPairs = WORD_CATEGORIES.flatMap((c) => c.hardPairs);
    expect(allHardPairs).toContainEqual({ civilian: result.civilian, imposter: result.imposter });
    expect(WORD_CATEGORIES.map((c) => c.label)).toContain(result.category);
  });

  it("falls back to a built-in word pair if every attempt returns an unusable response", async () => {
    parse.mockResolvedValue({ parsed_output: null });

    const result = await generateAiWordPair(undefined, "NORMAL", undefined);

    expect(parse).toHaveBeenCalledTimes(3);

    const allNormalPairs = WORD_CATEGORIES.flatMap((c) => c.normalPairs);
    expect(allNormalPairs).toContainEqual({ civilian: result.civilian, imposter: result.imposter });
  });

  it("rejects a pair that just echoes the theme back as one of the words, retrying for a better one", async () => {
    parse.mockResolvedValueOnce(parsedOutput({ civilian: "Pizza" })); // echoes theme "Pizza"
    parse.mockResolvedValueOnce(parsedOutput({ civilian: "Margherita", imposter: "Pepperoni" }));

    const result = await generateAiWordPair("Pizza", "NORMAL", undefined);

    expect(result).toEqual({ category: "Coffee drinks", civilian: "Margherita", imposter: "Pepperoni" });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("falls back to the best theme-echoing result if every attempt echoes the theme", async () => {
    parse.mockResolvedValue(parsedOutput({ civilian: "Pizza" }));

    const result = await generateAiWordPair("Pizza", "NORMAL", undefined);

    expect(parse).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ category: "Coffee drinks", civilian: "Pizza", imposter: "Espresso" });
  });

  it("truncates an overlong theme to 60 characters in the prompt sent to the model", async () => {
    parse.mockResolvedValueOnce(parsedOutput());

    const longTheme = "x".repeat(100);

    await generateAiWordPair(longTheme, "NORMAL", undefined);

    const request = parse.mock.calls[0][0] as { messages: { content: string }[] };
    const userMessage = request.messages[0].content;
    expect(userMessage).toContain("x".repeat(60));
    expect(userMessage).not.toContain("x".repeat(61));
  });

  it("uses a generic prompt when no theme is given", async () => {
    parse.mockResolvedValueOnce(parsedOutput());

    await generateAiWordPair(undefined, "NORMAL", undefined);

    const request = parse.mock.calls[0][0] as { messages: { content: string }[] };
    expect(request.messages[0].content).toBe("Invent a new civilian/imposter word pair.");
  });
});
