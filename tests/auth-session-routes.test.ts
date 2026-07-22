import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn()
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { POST as recover } from "@/app/api/auth/recover/route";
import { POST as updatePassword } from "@/app/api/auth/update-password/route";
import { POST as logout } from "@/app/api/auth/logout/route";

describe("authentication session routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://devtrack.example";
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: mocks.getUser,
        resetPasswordForEmail: mocks.resetPasswordForEmail,
        signOut: mocks.signOut,
        updateUser: mocks.updateUser
      },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) })
    });
  });

  it("starts recovery without revealing whether an account exists", async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
    const response = await recover(new NextRequest("https://devtrack.example/api/auth/recover", {
      method: "POST",
      body: JSON.stringify({ email: "learner@example.com" })
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("learner@example.com", {
      redirectTo: "https://devtrack.example/auth/callback?next=/update-password"
    });
  });

  it("rejects password updates without a recovery session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await updatePassword(new NextRequest("https://devtrack.example/api/auth/update-password", {
      method: "POST",
      body: JSON.stringify({ password: "a-secure-password" })
    }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("invalid or expired") });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("updates a recovery session and routes approved and unapproved learners once", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mocks.updateUser.mockResolvedValue({ error: null });
    mocks.maybeSingle.mockResolvedValueOnce({ data: { id: "user-1" }, error: null });
    const approved = await updatePassword(new NextRequest("https://devtrack.example/api/auth/update-password", {
      method: "POST",
      body: JSON.stringify({ password: "a-secure-password" })
    }));
    expect(await approved.json()).toMatchObject({ redirectTo: "/" });

    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const pending = await updatePassword(new NextRequest("https://devtrack.example/api/auth/update-password", {
      method: "POST",
      body: JSON.stringify({ password: "a-secure-password" })
    }));
    expect(await pending.json()).toMatchObject({ redirectTo: "/access-pending" });
  });

  it("logs out through Supabase so its response can clear the session cookies", async () => {
    mocks.signOut.mockResolvedValue({ error: null });
    const response = await logout();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
});
