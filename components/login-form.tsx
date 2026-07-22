"use client";
import { useState, type FormEvent } from "react";
import { DevTrackBrand } from "@/components/devtrack-brand";
import type { AuthenticationAvailability } from "@/lib/auth/providers";

export function LoginForm({ availability, returnTo, initialNotice, initialError }: { availability: AuthenticationAvailability; returnTo: string; initialNotice: string; initialError: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState(initialNotice);
  const [noticeIsError, setNoticeIsError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);
  const microsoftHref = `/api/auth/microsoft${returnTo === "/" ? "" : `?next=${encodeURIComponent(returnTo)}`}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setNotice("");
    setNoticeIsError(false);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, next: returnTo })
      });
      const body = await response.json() as { error?: string; redirectTo?: string };
      if (!response.ok || !body.redirectTo) { setNoticeIsError(true); return setNotice(body.error ?? "Sign-in could not be completed. Please try again."); }
      window.location.assign(body.redirectTo);
    } catch {
      setNoticeIsError(true);
      setNotice("Sign-in could not be completed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="login"><section className="card login-card"><DevTrackBrand href="/login" className="login-brand" /><p className="eyebrow">SECURE REPORTING</p><h1>Sign in</h1><p>Sign in to DevTrack with a configured Lexipol account. Access to reporting remains subject to organization approval.</p>
    {availability.microsoft && <a className="button microsoft-button" href={microsoftHref}>Continue with Microsoft</a>}
    {availability.microsoft && availability.emailPassword && <div className="login-divider"><span>or use administrator-issued credentials</span></div>}
    {availability.emailPassword && <form onSubmit={submit} noValidate={false}><label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required disabled={submitting} /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required disabled={submitting} /></label><button disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button></form>}
    {availability.emailPassword && <aside className="login-help"><h2>Signing in for the first time?</h2><p>If an administrator created your Supabase account without a password, use the secure setup link below. DevTrack will email the address on your account.</p><a href="/recover">Set up or reset your password</a></aside>}
    {availability.configurationError && <p className="notice error" role="alert">{availability.configurationError}</p>}
    {notice && <p className={noticeIsError ? "notice error" : "notice"} role={noticeIsError ? "alert" : "status"} aria-live="polite">{notice}</p>}
  </section></main>;
}
