import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), createServerClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));

import { middleware } from "@/middleware";

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
    const callback = await middleware(new NextRequest("https://devtrack.example/auth/callback?code=safe-code"));
    expect(login.status).toBe(200);
    expect(callback.status).toBe(200);
    expect(mocks.createServerClient).toHaveBeenCalledTimes(2);
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
});
