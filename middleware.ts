import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicAuthenticationPath, loginHref } from "@/lib/auth/redirects";
import { hasCapability, normalizeApplicationRole, type Capability } from "@/lib/auth/roles";
import {
  dataApiFetch, IMPERSONATION_COOKIE, impersonationCookieOptions,
  isBlockedDuringImpersonation, type RequestIdentityContext,
} from "@/lib/auth/impersonation";

export function isAuthenticationEntryRequest(requestUrl: string) {
  const path = requestUrl.split("?", 1)[0].replace(/\/+$/, "").toLowerCase();
  return path.endsWith("/login") || path.endsWith("/recover") || path.endsWith("/update-password") || path.endsWith("/auth/callback") || path.endsWith("/auth/confirm") || path.includes("/api/auth/");
}

export function protectedApiCapability(pathname: string): Capability | null {
  if (pathname.startsWith("/api/surveys")) return "view_surveys";
  if (pathname.startsWith("/api/projects/")) return "view_surveys";
  if (pathname === "/api/ask" || pathname === "/api/conversations" || pathname.startsWith("/api/conversations/")) return "view_standard_pages";
  if (pathname.startsWith("/api/admin/users")) return "manage_users";
  if (pathname.startsWith("/api/admin/")) return "manage_data";
  if (pathname.startsWith("/api/wrike/")) return "manage_integrations";
  return null;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const impersonationToken = request.cookies.get(IMPERSONATION_COOKIE)?.value ?? null;
  if (impersonationToken && isBlockedDuringImpersonation(request.nextUrl.pathname, request.method)) {
    return NextResponse.json({ error: "Exit impersonation before performing this action." }, { status: 409 });
  }
  // Vercel may normalize `nextUrl.pathname` differently from the matched route.
  // Bypass authentication entry URLs before session refresh or redirect logic so
  // a logged-out visitor can never be redirected from /login back to /login.
  if (isAuthenticationEntryRequest(request.url)) return response;
  const pathname = request.nextUrl.pathname;
  const publicAuthenticationPath = isPublicAuthenticationPath(pathname);

  type CookieUpdate = { name: string; value: string; options?: Parameters<typeof response.cookies.set>[2] };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    if (publicAuthenticationPath) return response;
    if (pathname.startsWith("/api/")) return response;
    const login = new URL("/login", request.url);
    login.searchParams.set("reason", "configuration_missing");
    login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }

  const supabase = createServerClient(url, key, {
    global: { fetch: dataApiFetch(impersonationToken) },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies: CookieUpdate[]) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (publicAuthenticationPath) return response;
    const apiCapability = protectedApiCapability(pathname);
    if (!user && apiCapability) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
    if (!user && !pathname.startsWith("/api/")) return NextResponse.redirect(new URL(loginHref(`${pathname}${request.nextUrl.search}`), request.url));
    let identity: RequestIdentityContext | null = null;
    if (user) {
      const identityResult = await supabase.rpc("current_request_identity");
      identity = identityResult.data as RequestIdentityContext | null;
      if (!identity && impersonationToken) {
        await supabase.rpc("end_administrator_impersonation");
        const expiredResponse = pathname.startsWith("/api/")
          ? NextResponse.json({ error: "The impersonation session expired." }, { status: 401 })
          : NextResponse.redirect(new URL(`${pathname}${request.nextUrl.search}`, request.url));
        expiredResponse.cookies.set(IMPERSONATION_COOKIE, "", impersonationCookieOptions(0));
        return expiredResponse;
      }
    }
    if (user && apiCapability) {
      let permitted = false;
      try {
        permitted = Boolean(identity && hasCapability(normalizeApplicationRole(identity.effectiveRole), apiCapability));
      } catch {
        permitted = false;
      }
      if (!permitted) return NextResponse.json({ error: "You do not have permission to perform this action." }, { status: 403 });
    }
  } catch {
    if (publicAuthenticationPath) return response;
    if (!pathname.startsWith("/api/")) {
      const login = new URL("/login", request.url);
      login.searchParams.set("reason", "service_unavailable");
      login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(login);
    }
  }
  return response;
}

export const config = {
  matcher: [
    "/",
    "/account-setup",
    "/admin/:path*",
    "/api/admin/:path*",
    "/api/ask",
    "/api/conversations/:path*",
    "/api/projects/:path*",
    "/api/wrike/:path*",
    "/api/surveys/:path*",
    "/api/impersonations/:path*",
    "/ask/:path*",
    "/development/:path*",
    "/id-dashboard/:path*",
    "/other-teams/:path*",
    "/projects/:path*",
    "/profile",
    "/sme-collaboration/:path*",
    "/sme-dashboard/:path*",
    "/surveys/:path*",
    "/tasks/:path*",
    "/team/:path*",
    "/time-entries/:path*"
  ]
};
