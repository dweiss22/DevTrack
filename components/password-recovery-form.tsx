"use client";
import { useState, type FormEvent } from "react";
import { DevTrackBrand } from "@/components/devtrack-brand";

export function PasswordRecoveryForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setMessage(""); setError(false);
    try {
      const response = await fetch("/api/auth/recover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const body = await response.json() as { error?: string; message?: string };
      setError(!response.ok);
      setMessage(response.ok ? body.message ?? "Check your email for a secure setup link." : body.error ?? "Password setup could not be started.");
    } catch { setError(true); setMessage("Password setup could not be started. Please retry."); }
    finally { setSubmitting(false); }
  }

  return <main className="login"><section className="card login-card"><DevTrackBrand href="/login" className="login-brand" /><p className="eyebrow">ACCOUNT SETUP</p><h1>Set up or reset your password</h1><p>Enter the email address used for your Supabase account. If the account is eligible, DevTrack will send a secure setup link.</p><form onSubmit={submit}><label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={submitting} /></label><button disabled={submitting}>{submitting ? "Sending…" : "Send secure setup link"}</button></form>{message && <p className={error ? "notice error" : "notice"} role={error ? "alert" : "status"} aria-live="polite">{message}</p>}<a className="login-back-link" href="/login">Back to sign in</a></section></main>;
}
