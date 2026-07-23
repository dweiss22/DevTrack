import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { dataApiFetch, IMPERSONATION_COOKIE } from "@/lib/auth/impersonation";

export async function createClient() {
  const store = await cookies();
  const impersonationToken = store.get(IMPERSONATION_COOKIE)?.value ?? null;
  type CookieUpdate = { name: string; value: string; options?: Parameters<typeof store.set>[2] };
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { fetch: dataApiFetch(impersonationToken) },
    cookies: { getAll: () => store.getAll(), setAll: (entries: CookieUpdate[]) => { try { entries.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* Server Components cannot write cookies. */ } } }
  });
}
