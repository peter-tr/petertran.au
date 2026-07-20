import { describe, it, expect } from "vitest";
import { FUNCTION_NAMES, LIVE_ALIAS_NAME, liveAliasArn } from "./function-names";

describe("liveAliasArn", () => {
  it("builds a qualified Lambda alias ARN from region/account/function name", () => {
    expect(liveAliasArn("ap-southeast-2", "123456789012", FUNCTION_NAMES.portfolio)).toBe(
      "arn:aws:lambda:ap-southeast-2:123456789012:function:portfolio-graphql:live"
    );
  });

  it("qualifies with LIVE_ALIAS_NAME regardless of which function name is passed", () => {
    const arn = liveAliasArn("ap-southeast-2", "999999999999", "some-other-fn");
    expect(arn.endsWith(`:${LIVE_ALIAS_NAME}`)).toBe(true);
  });
});

describe("FUNCTION_NAMES", () => {
  it("has no duplicate literal values - each Lambda needs a distinct name", () => {
    const values = Object.values(FUNCTION_NAMES);
    expect(new Set(values).size).toBe(values.length);
  });
});
