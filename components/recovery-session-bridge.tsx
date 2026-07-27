"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useEffect, useState } from "react";
import { DevTrackBrand } from "@/components/devtrack-brand";

export function RecoverySessionBridge({
  supabaseUrl,
  anonKey,
  configurationError = "",
}: {
  supabaseUrl: string;
  anonKey: string;
  configurationError?: string;
}) {
  const [message, setMessage] = useState(configurationError || "Verifying your secure password link…");
  const [error, setError] = useState(Boolean(configurationError));

  useEffect(() => {
    if (configurationError) return;

    async function establishRecoverySession() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      if (code) {
        const callback = new URL("/auth/callback", url.origin);
        callback.searchParams.set("code", code);
        callback.searchParams.set("next", "/update-password");
        window.location.replace(callback.toString());
        return;
      }

      const fragment = new URLSearchParams(url.hash.slice(1));
      const accessToken = fragment.get("access_token");
      const refreshToken = fragment.get("refresh_token");
      if (!accessToken || !refreshToken) {
        setError(true);
        setMessage(fragment.get("error_description")?.replaceAll("+", " ") || "This password link is invalid or expired. Request a new link.");
        return;
      }

      const supabase = createBrowserClient(supabaseUrl, anonKey);
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (sessionError) {
        setError(true);
        setMessage("This password link is invalid or expired. Request a new link.");
        return;
      }

      window.history.replaceState(null, "", "/auth/recovery");
      window.location.replace("/update-password");
    }

    void establishRecoverySession();
  }, [anonKey, configurationError, supabaseUrl]);

  return <main className="login">
    <section className="card login-card">
      <DevTrackBrand href="/login" className="login-brand" />
      <p className="eyebrow">ACCOUNT ACCESS</p>
      <h1>Open your secure link</h1>
      <p className={error ? "notice error" : "notice"} role={error ? "alert" : "status"} aria-live="polite">{message}</p>
      {error && <a className="login-back-link" href="/recover">Request a new password link</a>}
    </section>
  </main>;
}
