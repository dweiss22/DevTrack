import { afterEach, describe, expect, it, vi } from "vitest";
import { retryDelayMs, WrikeClient, wrikeBaseUrlForHost } from "@/lib/wrike/client";

afterEach(() => vi.unstubAllGlobals());
describe("Wrike client", () => {
  it("accepts Wrike US and EU data-center hosts and rejects unrelated hosts", () => {
    expect(wrikeBaseUrlForHost("www.wrike.com")).toBe("https://www.wrike.com/api/v4");
    expect(wrikeBaseUrlForHost("https://app-eu.wrike.com/")).toBe("https://app-eu.wrike.com/api/v4");
    expect(() => wrikeBaseUrlForHost("wrike.com.example.test")).toThrow(/invalid API host/i);
  });
  it("uses nextPageToken and preserves all pages", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "1" }], nextPageToken: "page two" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "2" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new WrikeClient("token", "https://app-eu.wrike.com/api/v4").all<{ id: string }>("/tasks?fields=x")).resolves.toEqual([{ id: "1" }, { id: "2" }]);
    expect(fetchMock.mock.calls[1][0]).toContain("nextPageToken=page%20two");
    expect(fetchMock.mock.calls[1][0]).not.toContain("pageToken=");
  });
  it("honors Retry-After seconds and HTTP dates before exponential fallback", () => {
    const now = Date.parse("2026-07-16T12:00:00Z");
    expect(retryDelayMs("3", 0, now)).toBe(3000);
    expect(retryDelayMs("Thu, 16 Jul 2026 12:00:05 GMT", 0, now)).toBe(5000);
    expect(retryDelayMs(null, 2, now)).toBe(1000);
  });
});
