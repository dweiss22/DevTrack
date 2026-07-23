import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ requireContext: vi.fn(), createAdminClient: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireContext: mocks.requireContext }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { PATCH } from "@/app/api/profile/route";

describe("personal profile updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireContext.mockResolvedValue({
      user: { id: "user-1" },
      profile: { organization_id: "organization-1", role: "member" },
    });
    const final = Promise.resolve({ error: null });
    const organizationEq = vi.fn().mockReturnValue(final);
    const userEq = vi.fn().mockReturnValue({ eq: organizationEq });
    mocks.update.mockReturnValue({ eq: userEq });
    mocks.createAdminClient.mockReturnValue({ from: () => ({ update: mocks.update }) });
  });

  it("updates only the signed-in user's organization-scoped display name", async () => {
    const response = await PATCH(new NextRequest("https://devtrack.example/api/profile", {
      method: "PATCH", body: JSON.stringify({ displayName: "  Updated Person  " }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ display_name: "Updated Person" }));
    const userEq = mocks.update.mock.results[0].value.eq;
    expect(userEq).toHaveBeenCalledWith("id", "user-1");
    expect(userEq.mock.results[0].value.eq).toHaveBeenCalledWith("organization_id", "organization-1");
  });

  it("does not accept browser-controlled role or membership changes", async () => {
    const response = await PATCH(new NextRequest("https://devtrack.example/api/profile", {
      method: "PATCH", body: JSON.stringify({ displayName: "Updated Person", role: "admin", organization_id: "organization-2" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.not.objectContaining({ role: "admin" }));
    expect(mocks.update).toHaveBeenCalledWith(expect.not.objectContaining({ organization_id: "organization-2" }));
  });
});
