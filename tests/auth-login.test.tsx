import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isPublicAuthenticationPath, loginHref, safeInternalPath } from "@/lib/auth/redirects";
import { loadAuthenticationAvailability } from "@/lib/auth/providers";

const source = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("authentication entry workflow", () => {
  it("keeps login and callback routes public while preserving protected return paths", () => {
    expect(isPublicAuthenticationPath("/login")).toBe(true);
    expect(isPublicAuthenticationPath("/auth/callback")).toBe(true);
    expect(isPublicAuthenticationPath("/api/auth/login")).toBe(true);
    expect(isPublicAuthenticationPath("/projects")).toBe(false);
    expect(loginHref("/projects?year=2026")).toBe("/login?next=%2Fprojects%3Fyear%3D2026");
  });

  it("rejects external, malformed, and looping return URLs", () => {
    expect(safeInternalPath("https://malicious.example/path")).toBe("/");
    expect(safeInternalPath("//malicious.example/path")).toBe("/");
    expect(safeInternalPath("/\\malicious.example/path")).toBe("/");
    expect(safeInternalPath("/login?next=/projects")).toBe("/");
    expect(safeInternalPath("/development?sort=title")).toBe("/development?sort=title");
  });

  it("reports missing authentication configuration without exposing a secret", async () => {
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    await expect(loadAuthenticationAvailability()).resolves.toEqual({ emailPassword: false, microsoft: false, configurationError: expect.stringContaining("not configured") });
    if (originalUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  });

  it("shows only sign-in methods confirmed by Supabase", async () => {
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ external: { email: true, azure: false } }), { status: 200 }));
    await expect(loadAuthenticationAvailability()).resolves.toEqual({ emailPassword: true, microsoft: false, configurationError: null });
    fetchMock.mockRestore();
    if (originalUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl; else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (originalKey) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey; else delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("provides password login, recovery guidance, and accessible feedback", () => {
    const login = source("components/login-form.tsx");
    expect(login).toContain('fetch("/api/auth/login"');
    expect(login).toContain("Continue with Microsoft");
    expect(login).toContain("Set up or reset your password");
    expect(login).toContain('aria-live="polite"');
    expect(source("components/password-recovery-form.tsx")).toContain('fetch("/api/auth/recover"');
  });

  it("keeps the public login page independent of protected reporting loaders", () => {
    const loginPage = source("app/login/page.tsx");
    expect(loginPage).not.toContain("@/lib/reporting/");
    expect(loginPage).not.toContain("requireContext");
    expect(loginPage).toContain("loadAuthenticationAvailability");
  });

  it("establishes OAuth sessions and sends unapproved users to access pending", () => {
    const callback = source("app/auth/callback/route.ts");
    expect(callback).toContain("exchangeCodeForSession(code)");
    expect(callback).toContain('applicationUser ? next : "/access-pending"');
    expect(source("lib/auth.ts")).toContain('redirect("/access-pending")');
  });
});
