import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ requireContext: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireContext: mocks.requireContext }));

import { PATCH } from "@/app/api/profile/route";

describe("personal profile updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireContext.mockResolvedValue({
      user: { id: "user-1" },
      profile: { organization_id: "organization-1", role: "member" },
      supabase: { rpc: mocks.rpc },
    });
    mocks.rpc.mockResolvedValue({ error: null });
  });

  it("updates only the signed-in user's organization-scoped display name", async () => {
    const response = await PATCH(new NextRequest("https://devtrack.example/api/profile", {
      method: "PATCH", body: JSON.stringify({ displayName: "  Updated Person  " }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("update_current_profile", { target_display_name: "Updated Person" });
  });

  it("does not accept browser-controlled role or membership changes", async () => {
    const response = await PATCH(new NextRequest("https://devtrack.example/api/profile", {
      method: "PATCH", body: JSON.stringify({ displayName: "Updated Person", role: "admin", organization_id: "organization-2" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("update_current_profile", { target_display_name: "Updated Person" });
  });
});
