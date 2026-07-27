import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  getUser: vi.fn(),
  serverMaybeSingle: vi.fn(),
  adminMaybeSingle: vi.fn(),
  adminUpdateResult: vi.fn(),
  acceptLegacyInvitation: vi.fn(),
  listUsers: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST as recover } from "@/app/api/auth/recover/route";
import { POST as updatePassword } from "@/app/api/auth/update-password/route";
import { POST as logout } from "@/app/api/auth/logout/route";

function query(result: ReturnType<typeof vi.fn>) {
  const chain = { eq: vi.fn(), maybeSingle: vi.fn() };
  chain.eq.mockReturnValue(chain);
  chain.maybeSingle.mockImplementation(() => result());
  return chain;
}

function updateQuery(result: ReturnType<typeof vi.fn>) {
  const chain = { eq: vi.fn() };
  chain.eq.mockImplementation(() => chain);
  Object.defineProperty(chain, "then", {
    value: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  });
  return chain;
}

describe("authentication session routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://devtrack.example";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: mocks.getUser,
        signOut: mocks.signOut,
        updateUser: mocks.updateUser,
      },
      from: () => ({ select: () => query(mocks.serverMaybeSingle) }),
    });

    mocks.listUsers.mockResolvedValue({
      data: { users: [{ id: "user-1", email: "learner@example.com", email_confirmed_at: "now" }] },
      error: null,
    });
    mocks.adminMaybeSingle.mockResolvedValue({ data: { id: "user-1", account_state: "active" }, error: null });
    mocks.adminUpdateResult.mockReturnValue({ error: null });
    mocks.acceptLegacyInvitation.mockResolvedValue({ data: { accepted: false }, error: null });
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
    mocks.createAdminClient.mockReturnValue({
      auth: {
        admin: { listUsers: mocks.listUsers },
        resetPasswordForEmail: mocks.resetPasswordForEmail,
      },
      rpc: mocks.acceptLegacyInvitation,
      from: () => ({
        select: () => query(mocks.adminMaybeSingle),
        update: () => updateQuery(mocks.adminUpdateResult),
      }),
    });
  });

  it("sends the same recovery link only for an active DevTrack user", async () => {
    const response = await recover(new NextRequest("https://devtrack.example/api/auth/recover", {
      method: "POST",
      body: JSON.stringify({ email: " Learner@Example.com " }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("learner@example.com", {
      redirectTo: "https://devtrack.example/auth/recovery",
    });
  });

  it("does not reveal or email an identity without active DevTrack membership", async () => {
    mocks.adminMaybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await recover(new NextRequest("https://devtrack.example/api/auth/recover", {
      method: "POST",
      body: JSON.stringify({ email: "learner@example.com" }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, message: expect.stringContaining("If this email") });
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("rejects password updates without a recovery session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await updatePassword(new NextRequest("https://devtrack.example/api/auth/update-password", {
      method: "POST",
      body: JSON.stringify({ password: "a-secure-password" }),
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("invalid or expired") });
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("updates an active user's password, retires legacy setup state, and keeps the current session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1", email: "learner@example.com" } } });
    mocks.serverMaybeSingle.mockResolvedValue({
      data: { id: "user-1", role: "id", account_state: "active", profile_completed: false },
      error: null,
    });
    mocks.updateUser.mockResolvedValue({ error: null });
    mocks.signOut.mockResolvedValue({ error: null });

    const response = await updatePassword(new NextRequest("https://devtrack.example/api/auth/update-password", {
      method: "POST",
      body: JSON.stringify({ password: "a-secure-password" }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, redirectTo: "/" });
    expect(mocks.createAdminClient).toHaveBeenCalled();
    expect(mocks.acceptLegacyInvitation).toHaveBeenCalledWith("accept_application_user_invitation", {
      target_user_id: "user-1",
      target_email: "learner@example.com",
    });
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "a-secure-password" });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("rejects a valid recovery session that has no active DevTrack access", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mocks.serverMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await updatePassword(new NextRequest("https://devtrack.example/api/auth/update-password", {
      method: "POST",
      body: JSON.stringify({ password: "a-secure-password" }),
    }));

    expect(response.status).toBe(403);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("logs out through Supabase so its response can clear the session cookies", async () => {
    mocks.signOut.mockResolvedValue({ error: null });
    const response = await logout();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
});
