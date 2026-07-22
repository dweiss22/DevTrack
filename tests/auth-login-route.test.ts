import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ signInWithPassword: vi.fn(), maybeSingle: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { POST } from "@/app/api/auth/login/route";

describe("password login route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({
      auth: { signInWithPassword: mocks.signInWithPassword },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) })
    });
  });

  it("rejects missing fields and invalid credentials with safe messages", async () => {
    const missing = await POST(new NextRequest("https://devtrack.example/api/auth/login", { method: "POST", body: JSON.stringify({ email: "bad" }) }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "Enter a valid email and password." });
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null }, error: new Error("raw provider detail") });
    const invalid = await POST(new NextRequest("https://devtrack.example/api/auth/login", { method: "POST", body: JSON.stringify({ email: "user@example.com", password: "not-the-password" }) }));
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toEqual({ error: "The email or password is incorrect." });
  });

  it("honors a safe return URL for approved users", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mocks.maybeSingle.mockResolvedValue({ data: { id: "user-1" }, error: null });
    const response = await POST(new NextRequest("https://devtrack.example/api/auth/login", { method: "POST", body: JSON.stringify({ email: "user@example.com", password: "correct-password", next: "/projects?year=2026" }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ redirectTo: "/projects?year=2026" });
  });

  it("rejects an external return URL and keeps unapproved users in access pending", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mocks.maybeSingle.mockResolvedValueOnce({ data: { id: "user-1" }, error: null });
    const external = await POST(new NextRequest("https://devtrack.example/api/auth/login", { method: "POST", body: JSON.stringify({ email: "user@example.com", password: "correct-password", next: "https://malicious.example" }) }));
    expect((await external.json()).redirectTo).toBe("/");
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const pending = await POST(new NextRequest("https://devtrack.example/api/auth/login", { method: "POST", body: JSON.stringify({ email: "user@example.com", password: "correct-password" }) }));
    expect((await pending.json()).redirectTo).toBe("/access-pending");
  });
});
