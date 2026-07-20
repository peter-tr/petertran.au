import { describe, it, expect, vi, beforeEach } from "vitest";
import { warmUp } from "./warmUp";

describe("warmUp", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({}));
  });

  it("does nothing when the endpoint is undefined", () => {
    warmUp(undefined);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts a minimal keepalive request to the endpoint", () => {
    warmUp("https://api.test/pantry");

    expect(fetch).toHaveBeenCalledTimes(1);

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.test/pantry");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
    });
    expect(JSON.parse(init.body)).toEqual({ query: "{ __typename }" });
  });

  it("only warms each distinct endpoint once", () => {
    warmUp("https://api.test/imposter");
    warmUp("https://api.test/imposter");
    warmUp("https://api.test/imposter");

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("swallows fetch rejections", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    expect(() => warmUp("https://api.test/fails")).not.toThrow();
    // Let the rejected promise's .catch() microtask flush.
    await Promise.resolve();
    await Promise.resolve();
  });
});
