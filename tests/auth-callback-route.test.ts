import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ exchange: vi.fn(), getUser: vi.fn(), maybeSingle: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { GET } from "@/app/auth/callback/route";

describe("authentication callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({
      auth: { exchangeCodeForSession: mocks.exchange, getUser: mocks.getUser },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) })
    });
    mocks.exchange.mockResolvedValue({ error: null });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("establishes the session and honors a safe return path for approved users", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: "user-1" }, error: null });
    const response = await GET(new NextRequest("https://devtrack.example/auth/callback?code=auth-code&next=%2Fprojects"));
    expect(mocks.exchange).toHaveBeenCalledWith("auth-code");
    expect(response.headers.get("location")).toBe("https://devtrack.example/projects");
  });

  it("sends authenticated users without application access to access pending", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await GET(new NextRequest("https://devtrack.example/auth/callback?code=auth-code"));
    expect(response.headers.get("location")).toBe("https://devtrack.example/access-pending");
  });

  it("lets a valid recovery session choose a password before the approval gate", async () => {
    const response = await GET(new NextRequest("https://devtrack.example/auth/callback?code=recovery-code&next=%2Fupdate-password"));
    expect(mocks.exchange).toHaveBeenCalledWith("recovery-code");
    expect(response.headers.get("location")).toBe("https://devtrack.example/update-password");
    expect(mocks.maybeSingle).not.toHaveBeenCalled();
  });

  it("returns safely to login when code exchange fails", async () => {
    mocks.exchange.mockResolvedValue({ error: new Error("raw provider detail") });
    const response = await GET(new NextRequest("https://devtrack.example/auth/callback?code=bad-code"));
    expect(response.headers.get("location")).toBe("https://devtrack.example/login?reason=callback_failed");
  });
});
