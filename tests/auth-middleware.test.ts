import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), createServerClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));

import { config, isAuthenticationEntryRequest, middleware } from "@/middleware";

async function followApplicationRedirects(startUrl: string, maximumRedirects = 2) {
  let currentUrl = startUrl;
  const chain: Array<{ status: number; url: string; location: string | null }> = [];
  for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
    const matches = unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: currentUrl });
    const response = matches ? await middleware(new NextRequest(currentUrl)) : new Response(null, { status: 200 });
    const location = response.headers.get("location");
    chain.push({ status: response.status, url: currentUrl, location });
    if (!location) return chain;
    if (redirectCount === maximumRedirects) throw new Error(`Exceeded ${maximumRedirects} redirects: ${chain.map((entry) => entry.url).join(" -> ")}`);
    currentUrl = new URL(location, currentUrl).toString();
  }
  return chain;
}

describe("authentication middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
    mocks.createServerClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
  });

  it("allows login and callback routes even when Supabase session refresh is unavailable", async () => {
    mocks.getUser.mockRejectedValue(new Error("temporary outage"));
    const login = await middleware(new NextRequest("https://devtrack.example/login"));
    const trailingLogin = await middleware(new NextRequest("https://devtrack.example/login/"));
    const callback = await middleware(new NextRequest("https://devtrack.example/auth/callback?code=safe-code"));
    const confirm = await middleware(new NextRequest("https://devtrack.example/auth/confirm?token_hash=safe&type=invite"));
    expect(login.status).toBe(200);
    expect(trailingLogin.status).toBe(200);
    expect(callback.status).toBe(200);
    expect(confirm.status).toBe(200);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(isAuthenticationEntryRequest("https://devtrack-indol.vercel.app/login?next=%2Fprojects")).toBe(true);
    expect(isAuthenticationEntryRequest("https://devtrack-indol.vercel.app/recover/")).toBe(true);
    expect(isAuthenticationEntryRequest("https://devtrack-indol.vercel.app/projects")).toBe(false);
  });

  it("only runs middleware on protected application routes", () => {
    for (const path of ["/", "/projects", "/projects/task-id", "/admin", "/development"]) {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: `https://devtrack.example${path}` }), path).toBe(true);
    }
    for (const path of ["/login", "/login/", "/recover", "/update-password", "/access-pending", "/auth/callback", "/auth/confirm", "/api/auth/login", "/api/auth/logout"]) {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: `https://devtrack.example${path}` }), path).toBe(false);
    }
  });

  it("redirects a logged-out protected request and preserves its internal path", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await middleware(new NextRequest("https://devtrack.example/projects?year=2026"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://devtrack.example/login?next=%2Fprojects%3Fyear%3D2026");
  });

  it("does not loop when Supabase authentication is temporarily unavailable", async () => {
    mocks.getUser.mockRejectedValue(new Error("temporary outage"));
    const response = await middleware(new NextRequest("https://devtrack.example/development"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://devtrack.example/login?reason=service_unavailable&next=%2Fdevelopment");
    const login = await middleware(new NextRequest(String(response.headers.get("location"))));
    expect(login.status).toBe(200);
  });

  it("ends anonymous and stale-session redirect chains at the public login route", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(followApplicationRedirects("https://devtrack.example/login", 1)).resolves.toEqual([
      { status: 200, url: "https://devtrack.example/login", location: null }
    ]);
    await expect(followApplicationRedirects("https://devtrack.example/projects?year=2026", 1)).resolves.toEqual([
      { status: 307, url: "https://devtrack.example/projects?year=2026", location: "https://devtrack.example/login?next=%2Fprojects%3Fyear%3D2026" },
      { status: 200, url: "https://devtrack.example/login?next=%2Fprojects%3Fyear%3D2026", location: null }
    ]);

    mocks.getUser.mockRejectedValueOnce(new Error("invalid refresh token"));
    const staleChain = await followApplicationRedirects("https://devtrack.example/development", 1);
    expect(staleChain).toHaveLength(2);
    expect(staleChain[0].location).toBe("https://devtrack.example/login?reason=service_unavailable&next=%2Fdevelopment");
    expect(staleChain[1]).toMatchObject({ status: 200, location: null });
  });
});
