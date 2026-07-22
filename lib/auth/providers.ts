export type AuthenticationAvailability = {
  emailPassword: boolean;
  microsoft: boolean;
  configurationError: string | null;
};

export async function loadAuthenticationAvailability(): Promise<AuthenticationAvailability> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { emailPassword: false, microsoft: false, configurationError: "Sign-in is not configured for this environment. Contact a DevTrack administrator." };

  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/settings`, {
      headers: { apikey: key },
      cache: "no-store",
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) throw new Error("Auth settings unavailable");
    const settings = await response.json() as { external?: Record<string, boolean> };
    const emailPassword = settings.external?.email === true;
    const microsoft = settings.external?.azure === true;
    return {
      emailPassword,
      microsoft,
      configurationError: emailPassword || microsoft ? null : "No sign-in method is currently enabled. Contact a DevTrack administrator."
    };
  } catch {
    return { emailPassword: false, microsoft: false, configurationError: "Sign-in services are temporarily unavailable. Retry shortly or contact a DevTrack administrator." };
  }
}
