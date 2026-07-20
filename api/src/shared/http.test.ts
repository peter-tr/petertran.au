import { describe, expect, it } from "vitest";
import { parseJsonBody } from "./http";

describe("parseJsonBody", () => {
  it("parses a plain (non-base64) JSON body", () => {
    const event = { body: JSON.stringify({ foo: "bar" }), isBase64Encoded: false };

    expect(parseJsonBody<{ foo: string }>(event)).toEqual({ foo: "bar" });
  });

  it("decodes and parses a base64-encoded body", () => {
    const payload = { hello: "world", n: 42 };
    const event = {
      body: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
      isBase64Encoded: true,
    };

    expect(parseJsonBody<typeof payload>(event)).toEqual(payload);
  });

  it("defaults to an empty object when body is undefined", () => {
    expect(parseJsonBody<Record<string, unknown>>({})).toEqual({});
  });

  it("defaults to an empty object when body is undefined even if isBase64Encoded is true", () => {
    expect(parseJsonBody<Record<string, unknown>>({ isBase64Encoded: true })).toEqual({});
  });

  it("throws on malformed JSON in a plain body", () => {
    expect(() => parseJsonBody({ body: "{not json" })).toThrow();
  });

  it("throws when a base64 flag is set but the body is actually plain JSON", () => {
    // Regression case from the file's own comment: treating a raw JSON body
    // as base64 (or vice versa) fails to parse rather than silently succeeding.
    const event = { body: JSON.stringify({ foo: "bar" }), isBase64Encoded: true };

    expect(() => parseJsonBody(event)).toThrow();
  });
});
