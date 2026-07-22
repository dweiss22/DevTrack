"use client";
import { useState, type FormEvent } from "react";
import { DevTrackBrand } from "@/components/devtrack-brand";

export function UpdatePasswordForm({ configurationError = "" }: { configurationError?: string }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState(configurationError);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) return setMessage("The passwords do not match.");
    setSubmitting(true); setMessage("");
    try {
      const response = await fetch("/api/auth/update-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const body = await response.json() as { error?: string; redirectTo?: string };
      if (!response.ok || !body.redirectTo) return setMessage(body.error ?? "Your password could not be updated.");
      window.location.assign(body.redirectTo);
    } catch { setMessage("Your password could not be updated. Please retry."); }
    finally { setSubmitting(false); }
  }

  return <main className="login"><section className="card login-card"><DevTrackBrand href="/login" className="login-brand" /><p className="eyebrow">ACCOUNT SETUP</p><h1>Choose a password</h1><p>Use at least 12 characters. After setup, approved users enter DevTrack directly; other users continue to access approval.</p>{!configurationError && <form onSubmit={submit}><label>New password<input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} /></label><label>Confirm new password<input type="password" autoComplete="new-password" minLength={12} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={submitting} /></label><button disabled={submitting}>{submitting ? "Saving…" : "Save password"}</button></form>}{message && <p className="notice error" role="alert" aria-live="polite">{message}</p>}</section></main>;
}
