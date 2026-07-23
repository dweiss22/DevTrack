export const IMPERSONATION_COOKIE = "devtrack-impersonation";
export const IMPERSONATION_HEADER = "x-devtrack-impersonation";
export const IMPERSONATION_IDLE_SECONDS = 15 * 60;
export const IMPERSONATION_MAX_SECONDS = 60 * 60;

export type RequestIdentityContext = {
  actorUserId: string;
  actorRole: "super_admin" | "admin" | "id" | "sme";
  actorName: string;
  effectiveUserId: string;
  effectiveRole: "super_admin" | "admin" | "id" | "sme";
  effectiveName: string;
  effectiveEmail?: string | null;
  organizationId: string;
  impersonationSessionId: string | null;
  impersonating: boolean;
  lastActivityAt: string | null;
  absoluteExpiresAt: string | null;
  operationalPersonaRole?: "id" | null;
};

export async function newImpersonationToken() {
  const sessionPart = crypto.randomUUID();
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(randomBytes, (value) => value.toString(16).padStart(2, "0")).join("");
  const token = `${sessionPart}.${secret}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  return { token, hash };
}

export function dataApiFetch(token?: string | null): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!token || !url.includes("/rest/v1/")) return fetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(IMPERSONATION_HEADER, token);
    return fetch(input, { ...init, headers });
  };
}

export function impersonationCookieOptions(maxAge = IMPERSONATION_MAX_SECONDS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export function isBlockedDuringImpersonation(pathname: string, method: string) {
  if (pathname === "/recover" || pathname === "/update-password"
    || pathname.startsWith("/api/admin/impersonations")
    || pathname.startsWith("/api/admin/users")
    || pathname.startsWith("/api/wrike/connect")
    || pathname.startsWith("/api/wrike/disconnect")) return true;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  return pathname === "/api/auth/logout"
    || pathname.startsWith("/api/auth/recover")
    || pathname.startsWith("/api/auth/update-password")
    || pathname.startsWith("/api/auth/complete-invitation");
}
