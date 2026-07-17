import { env } from "@/lib/env";

export class WrikeApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export type WrikeRequestEvent = { path: string; method: string; attempt: number; status?: number };
type RefreshedWrikeSession = { accessToken: string; apiBaseUrl?: string };
type WrikeClientOptions = {
  onUnauthorized?: () => Promise<RefreshedWrikeSession>;
  onRequest?: (event: WrikeRequestEvent) => void;
};

export function retryDelayMs(retryAfter: string | null, attempt: number, now = Date.now()) {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.max(0, retryAt - now);
  }
  return 250 * 2 ** attempt;
}

export function wrikeBaseUrlForHost(host: string) {
  const normalized = host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!normalized || !/(^|\.)wrike\.com$/.test(normalized)) throw new Error("Wrike returned an invalid API host.");
  return `https://${normalized}/api/v4`;
}

export function redactWrikeLogDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactWrikeLogDetails);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    /(authorization|access.?token|refresh.?token|client.?secret)/i.test(key) ? "[REDACTED]" : redactWrikeLogDetails(item)
  ]));
}

export function logWrikeEvent(level: "info" | "warn" | "error", event: string, details: Record<string, unknown>) {
  const safeDetails = redactWrikeLogDetails(details) as Record<string, unknown>;
  const payload = JSON.stringify({ service: "wrike", event, ...safeDetails });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.info(payload);
}

export class WrikeClient {
  private refreshPromise: Promise<RefreshedWrikeSession> | null = null;
  constructor(private accessToken: string, private baseUrl = env.WRIKE_API_BASE_URL, private options: WrikeClientOptions = {}) {}
  async request<T>(path: string, init: RequestInit = {}, retries = 3): Promise<T> {
    let refreshedAfterUnauthorized = false;
    for (let attempt = 0; attempt <= retries; attempt++) {
      this.options.onRequest?.({ path, method: init.method ?? "GET", attempt });
      const requestAccessToken = this.accessToken;
      const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { Authorization: `Bearer ${requestAccessToken}`, Accept: "application/json", ...init.headers }, cache: "no-store" });
      if (response.ok) return response.json() as Promise<T>;
      if (response.status === 401 && !refreshedAfterUnauthorized && this.options.onUnauthorized) {
        refreshedAfterUnauthorized = true;
        if (this.accessToken === requestAccessToken) {
          this.refreshPromise ??= this.options.onUnauthorized().finally(() => { this.refreshPromise = null; });
          const refreshed = await this.refreshPromise;
          this.accessToken = refreshed.accessToken;
          if (refreshed.apiBaseUrl) this.baseUrl = refreshed.apiBaseUrl;
        }
        attempt--;
        continue;
      }
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        const delay = retryDelayMs(response.headers.get("retry-after"), attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      const payload = await response.clone().json().catch(() => null) as { errorDescription?: string; error?: string } | null;
      const detail = payload?.errorDescription ?? payload?.error;
      throw new WrikeApiError(`Wrike request failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : "."}`, response.status);
    }
    throw new Error("Wrike retry loop ended unexpectedly.");
  }
  async all<T>(path: string): Promise<T[]> {
    return (await this.allWithStats<T>(path)).records;
  }
  async allWithStats<T>(path: string): Promise<{ records: T[]; pages: number }> {
    const records: T[] = []; let nextPageToken: string | undefined;
    let pages = 0;
    while (true) {
      const connector = path.includes("?") ? "&" : "?";
      const tokenQuery = nextPageToken ? `&nextPageToken=${encodeURIComponent(nextPageToken)}` : "";
      const page = await this.request<{ data: T[]; nextPageToken?: string }>(`${path}${connector}pageSize=100${tokenQuery}`);
      pages++;
      records.push(...page.data); if (!page.nextPageToken) return { records, pages }; nextPageToken = page.nextPageToken;
    }
  }
}
