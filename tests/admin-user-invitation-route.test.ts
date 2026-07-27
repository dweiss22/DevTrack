import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  createAdminClient: vi.fn(),
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUserById: vi.fn(),
  deleteUser: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  membershipMaybeSingle: vi.fn(),
  membershipInsert: vi.fn(),
  invitationUpdate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireCapability: mocks.requireCapability }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST } from "@/app/api/admin/users/invitations/route";

function chain(finalMethod: "maybeSingle" | "in", final: ReturnType<typeof vi.fn>) {
  const query = {
    eq: vi.fn(),
    in: vi.fn(),
    maybeSingle: vi.fn(),
  };
  query.eq.mockReturnValue(query);
  query.in.mockImplementation((...args: unknown[]) => final(...args));
  query.maybeSingle.mockImplementation(() => final());
  return query;
}

describe("administrator user provisioning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://devtrack.example";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

    mocks.requireCapability.mockResolvedValue({
      profile: { organization_id: "organization-1", role: "admin" },
    });
    mocks.listUsers.mockResolvedValue({ data: { users: [] }, error: null });
    mocks.createUser.mockResolvedValue({
      data: { user: { id: "33333333-3333-4333-8333-333333333333", email: "learner@example.com", email_confirmed_at: "now" } },
      error: null,
    });
    mocks.updateUserById.mockResolvedValue({ data: { user: null }, error: null });
    mocks.deleteUser.mockResolvedValue({ error: null });
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
    mocks.membershipMaybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.membershipInsert.mockResolvedValue({ error: null });
    mocks.invitationUpdate.mockReturnValue(chain("in", vi.fn()));

    mocks.createAdminClient.mockReturnValue({
      auth: {
        admin: {
          listUsers: mocks.listUsers,
          createUser: mocks.createUser,
          updateUserById: mocks.updateUserById,
          deleteUser: mocks.deleteUser,
        },
        resetPasswordForEmail: mocks.resetPasswordForEmail,
      },
      from: (table: string) => {
        if (table === "application_users") {
          return {
            select: () => chain("maybeSingle", mocks.membershipMaybeSingle),
            insert: mocks.membershipInsert,
          };
        }
        if (table === "application_user_invitations") {
          return { update: mocks.invitationUpdate };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    });
  });

  it("creates an active membership and sends the standard password-recovery link", async () => {
    const response = await POST(new NextRequest("https://devtrack.example/api/admin/users/invitations", {
      method: "POST",
      body: JSON.stringify({ email: " Learner@Example.com ", role: "id" }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, emailSent: true });
    expect(mocks.createUser).toHaveBeenCalledWith({
      email: "learner@example.com",
      email_confirm: true,
    });
    expect(mocks.membershipInsert).toHaveBeenCalledWith(expect.objectContaining({
      id: "33333333-3333-4333-8333-333333333333",
      organization_id: "organization-1",
      role: "id",
      profile_completed: true,
    }));
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("learner@example.com", {
      redirectTo: "https://devtrack.example/auth/recovery",
    });
  });

  it("rejects an existing active membership without sending another email", async () => {
    mocks.listUsers.mockResolvedValue({
      data: { users: [{ id: "user-1", email: "learner@example.com", email_confirmed_at: "now" }] },
      error: null,
    });
    mocks.membershipMaybeSingle.mockResolvedValue({ data: { id: "user-1" }, error: null });

    const response = await POST(new NextRequest("https://devtrack.example/api/admin/users/invitations", {
      method: "POST",
      body: JSON.stringify({ email: "learner@example.com", role: "admin" }),
    }));

    expect(response.status).toBe(409);
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.membershipInsert).not.toHaveBeenCalled();
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("keeps access active and reports when automatic email delivery fails", async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({ error: { message: "provider unavailable" } });
    const response = await POST(new NextRequest("https://devtrack.example/api/admin/users/invitations", {
      method: "POST",
      body: JSON.stringify({ email: "learner@example.com", role: "sme" }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      emailSent: false,
      message: expect.stringContaining("was added to DevTrack"),
    });
  });

  it("rejects invalid input before creating a user", async () => {
    const response = await POST(new NextRequest("https://devtrack.example/api/admin/users/invitations", {
      method: "POST",
      body: JSON.stringify({ email: "not-email", role: "owner" }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
