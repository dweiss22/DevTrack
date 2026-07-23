import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  createAdminClient: vi.fn(),
  getUserById: vi.fn(),
  maybeSingle: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireCapability: mocks.requireCapability }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST } from "@/app/api/admin/users/approve/route";

const userId = "11111111-1111-4111-8111-111111111111";

describe("administrator user approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCapability.mockResolvedValue({ profile: { organization_id: "organization-1", role: "admin" } });
    mocks.createAdminClient.mockReturnValue({
      auth: { admin: { getUserById: mocks.getUserById } },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
        insert: mocks.insert,
      }),
    });
  });

  it("assigns a pending authentication account to the administrator's organization as a member", async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: { id: userId, email: "learner@example.com", user_metadata: { full_name: "Dev Track Learner" } } }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.insert.mockResolvedValue({ error: null });

    const response = await POST(new NextRequest("https://devtrack.example/api/admin/users/approve", {
      method: "POST",
      body: JSON.stringify({ userId }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.insert).toHaveBeenCalledWith({
      id: userId,
      organization_id: "organization-1",
      display_name: "Dev Track Learner",
      role: "id",
    });
  });

  it("does not reassign an account that already belongs to DevTrack", async () => {
    mocks.getUserById.mockResolvedValue({ data: { user: { id: userId, email: "learner@example.com" } }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: { id: userId }, error: null });

    const response = await POST(new NextRequest("https://devtrack.example/api/admin/users/approve", {
      method: "POST",
      body: JSON.stringify({ userId }),
    }));

    expect(response.status).toBe(409);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects an invalid account id before using the service-role client", async () => {
    const response = await POST(new NextRequest("https://devtrack.example/api/admin/users/approve", {
      method: "POST",
      body: JSON.stringify({ userId: "not-a-uuid" }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
