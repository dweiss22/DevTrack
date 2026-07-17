import { afterEach, describe, expect, it, vi } from "vitest";
import { redactWrikeLogDetails, retryDelayMs, WrikeClient, wrikeBaseUrlForHost } from "@/lib/wrike/client";

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
    const path = "/folders/F/tasks?descendants=true&plainTextCustomFields=true&subTasks=true&fields=%5B%22customFields%22%2C%22responsibleIds%22%5D";
    await expect(new WrikeClient("token", "https://app-eu.wrike.com/api/v4").all<{ id: string }>(path)).resolves.toEqual([{ id: "1" }, { id: "2" }]);
    expect(fetchMock.mock.calls[1][0]).toContain("nextPageToken=page%20two");
    expect(fetchMock.mock.calls[1][0]).not.toContain("pageToken=");
    expect(fetchMock.mock.calls[1][0]).toContain("descendants=true");
    expect(fetchMock.mock.calls[1][0]).toContain("plainTextCustomFields=true");
    expect(fetchMock.mock.calls[1][0]).toContain("subTasks=true");
    expect(fetchMock.mock.calls[1][0]).toContain("fields=%5B%22customFields%22%2C%22responsibleIds%22%5D");
    expect(fetchMock.mock.calls[1][0]).toContain("pageSize=100");
  });
  it("honors Retry-After seconds and HTTP dates before exponential fallback", () => {
    const now = Date.parse("2026-07-16T12:00:00Z");
    expect(retryDelayMs("3", 0, now)).toBe(3000);
    expect(retryDelayMs("Thu, 16 Jul 2026 12:00:05 GMT", 0, now)).toBe(5000);
    expect(retryDelayMs(null, 2, now)).toBe(1000);
  });
  it("retries 429 and 5xx responses and reports every HTTP attempt", async () => {
    const attempts: number[] = [];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(new Response("{}", { status: 503, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "ok" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new WrikeClient("token", "https://www.wrike.com/api/v4", { onRequest: ({ attempt }) => attempts.push(attempt) });
    await expect(client.request("/account")).resolves.toEqual({ data: [{ id: "ok" }] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(attempts).toEqual([0, 1, 2]);
  });
  it("performs one single-flight refresh for concurrent 401 responses and counts attempts", async () => {
    const requests: string[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string>).Authorization;
      return authorization === "Bearer fresh"
        ? new Response(JSON.stringify({ data: [] }), { status: 200 })
        : new Response(JSON.stringify({ error: "expired" }), { status: 401 });
    });
    const refresh = vi.fn(async () => ({ accessToken: "fresh" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new WrikeClient("expired", "https://www.wrike.com/api/v4", { onUnauthorized: refresh, onRequest: ({ path }) => requests.push(path) });
    await Promise.all([client.request("/account"), client.request("/folders/A/tasks")]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(requests).toHaveLength(4);
  });
  it("preserves status for non-retryable 403 and 404 responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("{}", { status: 403 })).mockResolvedValueOnce(new Response("{}", { status: 404 })));
    await expect(new WrikeClient("token", "https://www.wrike.com/api/v4").request("/forbidden")).rejects.toMatchObject({ status: 403 });
    await expect(new WrikeClient("token", "https://www.wrike.com/api/v4").request("/missing")).rejects.toMatchObject({ status: 404 });
  });
  it("redacts credentials from nested structured log details", () => {
    expect(redactWrikeLogDetails({ accessToken: "secret", nested: { Authorization: "Bearer secret", path: "/account" } })).toEqual({
      accessToken: "[REDACTED]",
      nested: { Authorization: "[REDACTED]", path: "/account" }
    });
  });
});
