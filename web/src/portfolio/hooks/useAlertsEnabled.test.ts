import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

describe("useAlertsEnabled", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("reports unavailable and never fetches when no endpoint is configured", async () => {
    vi.stubEnv("VITE_ALERTS_SETTINGS_ENDPOINT", "");

    const { useAlertsEnabled } = await import("./useAlertsEnabled");

    const { result } = renderHook(() => useAlertsEnabled());

    expect(result.current.available).toBe(false);
    expect(result.current.enabled).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads enabled from the endpoint on mount when available", async () => {
    vi.stubEnv("VITE_ALERTS_SETTINGS_ENDPOINT", "https://api.test/alerts-settings");
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => ({ enabled: true }) });

    const { useAlertsEnabled } = await import("./useAlertsEnabled");

    const { result } = renderHook(() => useAlertsEnabled());

    expect(result.current.available).toBe(true);
    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(fetch).toHaveBeenCalledWith("https://api.test/alerts-settings");
  });

  it("surfaces an error when the initial load fails", async () => {
    vi.stubEnv("VITE_ALERTS_SETTINGS_ENDPOINT", "https://api.test/alerts-settings");
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));

    const { useAlertsEnabled } = await import("./useAlertsEnabled");

    const { result } = renderHook(() => useAlertsEnabled());

    await waitFor(() => expect(result.current.error).toBe("Couldn't load alert email status"));
  });

  it("setEnabled POSTs the new value and updates state from the response", async () => {
    vi.stubEnv("VITE_ALERTS_SETTINGS_ENDPOINT", "https://api.test/alerts-settings");
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ json: async () => ({ enabled: true }) })
      .mockResolvedValueOnce({ json: async () => ({ enabled: false }) });

    const { useAlertsEnabled } = await import("./useAlertsEnabled");

    const { result } = renderHook(() => useAlertsEnabled());
    await waitFor(() => expect(result.current.enabled).toBe(true));

    act(() => {
      result.current.setEnabled(false);
    });

    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.enabled).toBe(false));
    expect(result.current.pending).toBe(false);

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
    expect(JSON.parse(init.body)).toEqual({ enabled: false });
  });

  it("setEnabled surfaces an error and clears pending on failure", async () => {
    vi.stubEnv("VITE_ALERTS_SETTINGS_ENDPOINT", "https://api.test/alerts-settings");
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ json: async () => ({ enabled: true }) })
      .mockRejectedValueOnce(new Error("network down"));

    const { useAlertsEnabled } = await import("./useAlertsEnabled");

    const { result } = renderHook(() => useAlertsEnabled());
    await waitFor(() => expect(result.current.enabled).toBe(true));

    act(() => {
      result.current.setEnabled(false);
    });

    await waitFor(() => expect(result.current.error).toBe("Couldn't update alert email status"));
    expect(result.current.pending).toBe(false);
  });

  it("setEnabled is a no-op when unavailable", async () => {
    vi.stubEnv("VITE_ALERTS_SETTINGS_ENDPOINT", "");

    const { useAlertsEnabled } = await import("./useAlertsEnabled");

    const { result } = renderHook(() => useAlertsEnabled());
    act(() => result.current.setEnabled(false));

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });
});
