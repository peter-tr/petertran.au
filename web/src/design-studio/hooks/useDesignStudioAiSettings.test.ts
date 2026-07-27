import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeAiSettings, useDesignStudioAiSettings } from "./useDesignStudioAiSettings";
import { getAiSettings, updateAiSettings, AiProvider, AiModelTier } from "../api";
import type { AiSettings } from "../api";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();

  return {
    ...actual,
    getAiSettings: vi.fn(),
    updateAiSettings: vi.fn(),
  };
});

const mockGetAiSettings = vi.mocked(getAiSettings);
const mockUpdateAiSettings = vi.mocked(updateAiSettings);

function makeSettings(overrides: Partial<AiSettings> = {}): AiSettings {
  return {
    provider: AiProvider.Anthropic,
    modelTier: AiModelTier.Haiku,
    allowSupergraphQuery: false,
    ...overrides,
  };
}

describe("mergeAiSettings", () => {
  it("overwrites fields present with non-null/non-undefined values", () => {
    const prev = makeSettings({ provider: AiProvider.Anthropic });
    const next = mergeAiSettings(prev, { provider: AiProvider.Bedrock });
    expect(next.provider).toBe(AiProvider.Bedrock);
  });

  it("skips a key whose value is explicitly null or undefined", () => {
    const prev = makeSettings({ allowSupergraphQuery: true });
    const next = mergeAiSettings(prev, { allowSupergraphQuery: undefined });
    expect(next.allowSupergraphQuery).toBe(true);
  });

  it("applies false as a real value, not treated as absent", () => {
    const prev = makeSettings({ allowSupergraphQuery: true });
    const next = mergeAiSettings(prev, { allowSupergraphQuery: false });
    expect(next.allowSupergraphQuery).toBe(false);
  });

  it("does not mutate the previous settings object", () => {
    const prev = makeSettings({ allowSupergraphQuery: false });
    const next = mergeAiSettings(prev, { allowSupergraphQuery: true });
    expect(prev.allowSupergraphQuery).toBe(false);
    expect(next).not.toBe(prev);
  });
});

describe("useDesignStudioAiSettings", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("loads settings on mount", async () => {
    const settings = makeSettings({ allowSupergraphQuery: true });
    mockGetAiSettings.mockResolvedValueOnce(settings);

    const { result } = renderHook(() => useDesignStudioAiSettings());

    expect(result.current.settings).toBeNull();
    await waitFor(() => expect(result.current.settings).toEqual(settings));
    expect(result.current.error).toBeNull();
  });

  it("sets an error message when the initial load fails", async () => {
    mockGetAiSettings.mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() => useDesignStudioAiSettings());

    await waitFor(() => expect(result.current.error).toBe("network down"));
    expect(result.current.settings).toBeNull();
  });

  it("applies updateSettings optimistically before the mutation resolves", async () => {
    const settings = makeSettings({ allowSupergraphQuery: false });
    mockGetAiSettings.mockResolvedValueOnce(settings);

    const { result } = renderHook(() => useDesignStudioAiSettings());
    await waitFor(() => expect(result.current.settings).toEqual(settings));

    mockUpdateAiSettings.mockReturnValueOnce(new Promise(() => {}));
    act(() => {
      result.current.updateSettings({ allowSupergraphQuery: true });
    });

    expect(result.current.settings?.allowSupergraphQuery).toBe(true);
  });

  it("reports a save error without reverting the optimistic update", async () => {
    const settings = makeSettings({ allowSupergraphQuery: false });
    mockGetAiSettings.mockResolvedValueOnce(settings);

    const { result } = renderHook(() => useDesignStudioAiSettings());
    await waitFor(() => expect(result.current.settings).toEqual(settings));

    mockUpdateAiSettings.mockRejectedValueOnce(new Error("save failed"));
    await act(async () => {
      result.current.updateSettings({ allowSupergraphQuery: true });
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.error).toBe("save failed"));
    expect(result.current.settings?.allowSupergraphQuery).toBe(true);
  });
});
