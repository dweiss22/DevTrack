import { env } from "@/lib/env";

export class WrikeApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export class WrikeClient {
  constructor(private accessToken: string) {}
  async request<T>(path: string, init: RequestInit = {}, retries = 3): Promise<T> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const response = await fetch(`${env.WRIKE_API_BASE_URL}${path}`, { ...init, headers: { Authorization: `bearer ${this.accessToken}`, Accept: "application/json", ...init.headers }, cache: "no-store" });
      if (response.ok) return response.json() as Promise<T>;
      if ((response.status === 429 || response.status >= 500) && attempt < retries) { await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt)); continue; }
      throw new WrikeApiError(`Wrike request failed (${response.status}).`, response.status);
    }
    throw new Error("Wrike retry loop ended unexpectedly.");
  }
  async all<T>(path: string): Promise<T[]> {
    const records: T[] = []; let nextPageToken: string | undefined;
    while (true) {
      const connector = path.includes("?") ? "&" : "?";
      const tokenQuery = nextPageToken ? `&pageToken=${encodeURIComponent(nextPageToken)}` : "";
      const page = await this.request<{ data: T[]; nextPageToken?: string }>(`${path}${connector}pageSize=100${tokenQuery}`);
      records.push(...page.data); if (!page.nextPageToken) return records; nextPageToken = page.nextPageToken;
    }
  }
}
