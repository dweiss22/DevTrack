import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicAuthenticationPath, loginHref } from "@/lib/auth/redirects";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
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
    if (!user && !pathname.startsWith("/api/")) return NextResponse.redirect(new URL(loginHref(`${pathname}${request.nextUrl.search}`), request.url));
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
  matcher: ["/((?!login(?:/|$)|recover(?:/|$)|update-password(?:/|$)|auth/callback(?:/|$)|api/auth(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
