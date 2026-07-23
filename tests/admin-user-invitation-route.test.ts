import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
  listUsers: vi.fn(),
  inviteUserByEmail: vi.fn(),
  insert: vi.fn(),
  insertSelect: vi.fn(),
  insertSingle: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST } from "@/app/api/admin/users/invitations/route";

function updateChain() {
  const chain = { eq: vi.fn() } as { eq: ReturnType<typeof vi.fn> };
  chain.eq.mockReturnValue(chain);
  return chain;
}

describe("administrator invitations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://devtrack.example";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    mocks.requireAdmin.mockResolvedValue({ user: { id: "admin-1" }, profile: { organization_id: "organization-1", role: "admin" } });
    mocks.listUsers.mockResolvedValue({ data: { users: [] }, error: null });
    mocks.insertSingle.mockResolvedValue({ data: { id: "22222222-2222-4222-8222-222222222222" }, error: null });
    mocks.insertSelect.mockReturnValue({ single: mocks.insertSingle });
    mocks.insert.mockReturnValue({ select: mocks.insertSelect });
    mocks.update.mockReturnValue(updateChain());
    mocks.inviteUserByEmail.mockResolvedValue({ data: { user: { id: "33333333-3333-4333-8333-333333333333" } }, error: null });
    mocks.createAdminClient.mockReturnValue({
      auth: {
        admin: { listUsers: mocks.listUsers, inviteUserByEmail: mocks.inviteUserByEmail },
        resetPasswordForEmail: vi.fn(),
      },
      from: (table: string) => {
        if (table === "application_user_invitations") return { insert: mocks.insert, update: mocks.update };
        return { select: vi.fn() };
      },
    });
  });

  it("creates an organization-scoped preauthorization and sends an app-owned setup link", async () => {
    const response = await POST(new NextRequest("https://devtrack.example/api/admin/users/invitations", {
      method: "POST", body: JSON.stringify({ email: " Learner@Example.com ", role: "member" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: "organization-1",
      email: "learner@example.com",
      normalized_email: "learner@example.com",
      role: "member",
      invited_by: "admin-1",
    }));
    expect(mocks.inviteUserByEmail).toHaveBeenCalledWith("learner@example.com", expect.objectContaining({
      redirectTo: "https://devtrack.example/auth/confirm?next=/account-setup",
    }));
  });

  it("handles a duplicate pending invitation without sending another email", async () => {
    mocks.insertSingle.mockResolvedValue({ data: null, error: { code: "23505" } });
    const response = await POST(new NextRequest("https://devtrack.example/api/admin/users/invitations", {
      method: "POST", body: JSON.stringify({ email: "learner@example.com", role: "admin" }),
    }));
    expect(response.status).toBe(409);
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("rejects invalid input before creating an invitation", async () => {
    const response = await POST(new NextRequest("https://devtrack.example/api/admin/users/invitations", {
      method: "POST", body: JSON.stringify({ email: "not-email", role: "owner" }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
