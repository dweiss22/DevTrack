"use client";
import { useState, type FormEvent } from "react";
import { DevTrackBrand } from "@/components/devtrack-brand";

export function AccountSetupForm({ email, initialDisplayName }: { email: string; initialDisplayName: string }) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) return setMessage("The passwords do not match.");
    setSubmitting(true); setMessage("");
    try {
      const response = await fetch("/api/auth/complete-invitation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, password }),
      });
      const body = await response.json() as { error?: string; redirectTo?: string };
      if (!response.ok) return setMessage(body.error ?? "Your account setup could not be completed.");
      window.location.assign(body.redirectTo ?? "/");
    } catch {
      setMessage("Your account setup could not be completed. Please retry.");
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="login"><section className="card login-card"><DevTrackBrand href="/login" className="login-brand" /><p className="eyebrow">WELCOME TO DEVTRACK</p><h1>Complete your account</h1><p>Your administrator has already approved access. Choose a password and confirm how your name should appear.</p><form onSubmit={submit}><label>Email<input value={email} readOnly aria-readonly="true" /></label><label>Display name<input autoComplete="name" minLength={2} maxLength={100} required value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={submitting} /></label><label>New password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} /></label><label>Confirm new password<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={submitting} /></label><button disabled={submitting}>{submitting ? "Completing setup…" : "Complete account setup"}</button></form>{message && <p className="notice error" role="alert" aria-live="polite">{message}</p>}</section></main>;
}
