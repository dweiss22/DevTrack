import { env } from "@/lib/env";

export class WrikeApiError extends Error { constructor(message: string, public status: number) { super(message); } }

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

export class WrikeClient {
  constructor(private accessToken: string, private baseUrl = env.WRIKE_API_BASE_URL) {}
  async request<T>(path: string, init: RequestInit = {}, retries = 3): Promise<T> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json", ...init.headers }, cache: "no-store" });
      if (response.ok) return response.json() as Promise<T>;
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
    const records: T[] = []; let nextPageToken: string | undefined;
    while (true) {
      const connector = path.includes("?") ? "&" : "?";
      const tokenQuery = nextPageToken ? `&nextPageToken=${encodeURIComponent(nextPageToken)}` : "";
      const page = await this.request<{ data: T[]; nextPageToken?: string }>(`${path}${connector}pageSize=100${tokenQuery}`);
      records.push(...page.data); if (!page.nextPageToken) return records; nextPageToken = page.nextPageToken;
    }
  }
}
