import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), createAdminClient: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { PATCH } from "@/app/api/admin/users/[id]/route";

const userId = "11111111-1111-4111-8111-111111111111";

describe("administrator role management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ profile: { organization_id: "organization-1", role: "admin" } });
    mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc });
    mocks.rpc.mockResolvedValue({ error: null });
  });

  it("changes a role only within the administrator's organization", async () => {
    const response = await PATCH(new NextRequest("https://devtrack.example/api/admin/users/id", {
      method: "PATCH", body: JSON.stringify({ role: "admin" }),
    }), { params: Promise.resolve({ id: userId }) });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("change_application_user_role", {
      target_organization_id: "organization-1",
      target_user_id: userId,
      target_role: "admin",
    });
  });

  it("rejects cross-organization targets without changing a role", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "P0001", message: "Organization member not found." } });
    const response = await PATCH(new NextRequest("https://devtrack.example/api/admin/users/id", {
      method: "PATCH", body: JSON.stringify({ role: "member" }),
    }), { params: Promise.resolve({ id: userId }) });
    expect(response.status).toBe(404);
  });

  it("does not demote the last organization administrator", async () => {
    mocks.rpc.mockResolvedValue({ error: { code: "23514", message: "The last organization administrator cannot be demoted." } });
    const response = await PATCH(new NextRequest("https://devtrack.example/api/admin/users/id", {
      method: "PATCH", body: JSON.stringify({ role: "member" }),
    }), { params: Promise.resolve({ id: userId }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("last administrator");
  });

  it("does not permit a non-administrator to reach the service-role operation", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("Administrator access is required."));
    await expect(PATCH(new NextRequest("https://devtrack.example/api/admin/users/id", {
      method: "PATCH", body: JSON.stringify({ role: "admin" }),
    }), { params: Promise.resolve({ id: userId }) })).rejects.toThrow("Administrator access is required");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
