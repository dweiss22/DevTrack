const UNSAFE_RETURN_PATHS = new Set(["/login", "/recover", "/auth/callback"]);
const PUBLIC_AUTHENTICATION_PATHS = new Set(["/login", "/recover", "/update-password", "/auth/callback"]);

export function safeInternalPath(value: string | null | undefined, fallback = "/") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return fallback;
  try {
    const parsed = new URL(value, "https://devtrack.invalid");
    if (parsed.origin !== "https://devtrack.invalid" || UNSAFE_RETURN_PATHS.has(parsed.pathname)) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function loginHref(next: string | null | undefined) {
  const safeNext = safeInternalPath(next);
  return safeNext === "/" ? "/login" : `/login?next=${encodeURIComponent(safeNext)}`;
}

export function isPublicAuthenticationPath(pathname: string) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PUBLIC_AUTHENTICATION_PATHS.has(normalized) || normalized.startsWith("/api/auth/");
}
