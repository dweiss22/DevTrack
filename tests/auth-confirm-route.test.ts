import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), createAdminClient: vi.fn(), verifyOtp: vi.fn(),
  getUser: vi.fn(), maybeSingle: vi.fn(), rpc: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { GET } from "@/app/auth/confirm/route";

describe("SSR email confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({
      auth: { verifyOtp: mocks.verifyOtp, getUser: mocks.getUser },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
    });
    mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.verifyOtp.mockResolvedValue({ error: null });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1", email: "invited@example.com" } } });
    mocks.rpc.mockResolvedValue({ data: { accepted: true }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: { id: "user-1", profile_completed: false }, error: null });
  });

  it("verifies an invite token, consumes the matching preauthorization, and opens setup", async () => {
    const response = await GET(new NextRequest("https://devtrack.example/auth/confirm?next=%2Faccount-setup&token_hash=safe-token-hash&type=invite"));
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: "safe-token-hash", type: "invite" });
    expect(mocks.rpc).toHaveBeenCalledWith("accept_application_user_invitation", {
      target_user_id: "user-1", target_email: "invited@example.com",
    });
    expect(response.headers.get("location")).toBe("https://devtrack.example/account-setup");
  });

  it("rejects missing or unsupported token parameters without calling Supabase", async () => {
    const response = await GET(new NextRequest("https://devtrack.example/auth/confirm?type=invite"));
    expect(response.headers.get("location")).toBe("https://devtrack.example/login?reason=callback_failed");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("sends ordinary password recovery to password update without changing membership", async () => {
    const response = await GET(new NextRequest("https://devtrack.example/auth/confirm?next=%2Fupdate-password&token_hash=recovery-token&type=recovery"));
    expect(response.headers.get("location")).toBe("https://devtrack.example/update-password");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
