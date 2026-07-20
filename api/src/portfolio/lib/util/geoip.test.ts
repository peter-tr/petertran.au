import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocationForIp } from "./geoip";

describe("getLocationForIp", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("returns null and never calls fetch for an undefined IP", async () => {
    const result = await getLocationForIp(undefined);
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "127.0.0.1",
    "10.0.0.5",
    "192.168.1.1",
    "172.16.0.1",
    "172.31.255.255",
    "::1",
    "fc00::1",
    "fe80::1",
  ])("returns null and never calls fetch for the private/loopback address %s", async (ip) => {
    const result = await getLocationForIp(ip);
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not treat a public address in the 172.32+ range as private", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "success", city: "Sydney", regionName: "NSW", country: "Australia" }),
    });

    const result = await getLocationForIp("172.32.0.1");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toBe("Sydney, NSW, Australia");
  });

  it("calls ip-api.com for a public IP and joins city/region/country", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "success",
        city: "Brisbane",
        regionName: "Queensland",
        country: "Australia",
      }),
    });

    const result = await getLocationForIp("8.8.8.8");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://ip-api.com/json/8.8.8.8",
      expect.objectContaining({ signal: expect.anything() })
    );
    expect(result).toBe("Brisbane, Queensland, Australia");
  });

  it("omits missing fields when joining the location", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "success",
        city: undefined,
        regionName: "Queensland",
        country: "Australia",
      }),
    });

    const result = await getLocationForIp("8.8.8.8");
    expect(result).toBe("Queensland, Australia");
  });

  it("returns null when every field is missing", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "success" }),
    });

    const result = await getLocationForIp("8.8.8.8");
    expect(result).toBeNull();
  });

  it("returns null when the response is not ok", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });

    const result = await getLocationForIp("8.8.8.8");
    expect(result).toBeNull();
  });

  it('returns null when the API reports status "fail"', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: "fail" }) });

    const result = await getLocationForIp("8.8.8.8");
    expect(result).toBeNull();
  });

  it("returns null when fetch throws (e.g. timeout)", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));

    const result = await getLocationForIp("8.8.8.8");
    expect(result).toBeNull();
  });

  it("returns null when the response body isn't valid JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("invalid json");
      },
    });

    const result = await getLocationForIp("8.8.8.8");
    expect(result).toBeNull();
  });
});
