import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("new-user authentication", () => {
  it("offers Microsoft authentication while retaining administrator-issued credentials", () => {
    const login = source("app/login/page.tsx");
    expect(login).toContain('href="/api/auth/microsoft"');
    expect(login).toContain("Continue with Microsoft");
    expect(login).toContain('fetch("/api/auth/login"');
    expect(login).toContain('role="alert"');
  });

  it("starts an Azure PKCE flow with the required email scope", () => {
    const route = source("app/api/auth/microsoft/route.ts");
    expect(route).toContain('provider: "azure"');
    expect(route).toContain('scopes: "email"');
    expect(route).toContain('new URL("/auth/callback", env.NEXT_PUBLIC_APP_URL)');
    expect(route).toContain("!value.startsWith(\"//\")");
  });

  it("exchanges the callback code and keeps unapproved users outside reporting", () => {
    const callback = source("app/auth/callback/route.ts");
    expect(callback).toContain("exchangeCodeForSession(code)");
    expect(callback).toContain('applicationUser ? next : "/access-pending"');
    expect(callback).toContain("!value.startsWith(\"//\")");
  });
});
