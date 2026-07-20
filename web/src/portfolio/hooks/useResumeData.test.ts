import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const { runQuery } = vi.hoisted(() => ({ runQuery: vi.fn() }));
vi.mock("../lib/graphql", () => ({ runQuery, RESUME_QUERY: "query Resume { person { name } }" }));

describe("useResumeData", () => {
  beforeEach(() => {
    runQuery.mockReset();
    vi.resetModules();
  });

  it("fetches and returns resume data", async () => {
    const data = { person: { name: "Peter" } };
    runQuery.mockResolvedValue(data);
    const { useResumeData } = await import("./useResumeData");

    const { result } = renderHook(() => useResumeData());

    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toEqual(data));
    expect(result.current.error).toBeNull();
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it("surfaces an Error's message on failure", async () => {
    runQuery.mockRejectedValue(new Error("network down"));
    const { useResumeData } = await import("./useResumeData");

    const { result } = renderHook(() => useResumeData());

    await waitFor(() => expect(result.current.error).toBe("network down"));
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic message for a non-Error rejection", async () => {
    runQuery.mockRejectedValue("weird failure");
    const { useResumeData } = await import("./useResumeData");

    const { result } = renderHook(() => useResumeData());

    await waitFor(() => expect(result.current.error).toBe("Failed to load"));
  });

  it("caches the in-flight/resolved fetch across remounts, calling runQuery only once", async () => {
    const data = { person: { name: "Peter" } };
    runQuery.mockResolvedValue(data);
    const { useResumeData } = await import("./useResumeData");

    const first = renderHook(() => useResumeData());
    await waitFor(() => expect(first.result.current.data).toEqual(data));

    const second = renderHook(() => useResumeData());
    await waitFor(() => expect(second.result.current.data).toEqual(data));

    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed fetch, so the next mount retries", async () => {
    runQuery.mockRejectedValueOnce(new Error("first failure"));
    runQuery.mockResolvedValueOnce({ person: { name: "Peter" } });
    const { useResumeData } = await import("./useResumeData");

    const first = renderHook(() => useResumeData());
    await waitFor(() => expect(first.result.current.error).toBe("first failure"));

    const second = renderHook(() => useResumeData());
    await waitFor(() => expect(second.result.current.data).toEqual({ person: { name: "Peter" } }));

    expect(runQuery).toHaveBeenCalledTimes(2);
  });
});
