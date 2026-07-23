"use client";
import { useState, type FormEvent } from "react";
import { normalizeApplicationRole, roleLabel } from "@/lib/auth/roles";

export function ProfileForm({ email, initialDisplayName, role }: { email: string; initialDisplayName: string; role: string }) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setMessage(""); setError(false);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) { setError(true); setMessage(body.error ?? "Your profile could not be updated."); return; }
      setMessage("Profile updated.");
    } catch {
      setError(true); setMessage("Your profile could not be updated. Please retry.");
    } finally {
      setSubmitting(false);
    }
  }

  return <section className="card profile-card"><form onSubmit={submit}><label>Display name<input autoComplete="name" minLength={2} maxLength={100} required value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={submitting} /></label><label>Email<input value={email} readOnly aria-readonly="true" /></label><label>Application role<input value={roleLabel(normalizeApplicationRole(role))} readOnly aria-readonly="true" /></label><button disabled={submitting}>{submitting ? "Saving…" : "Save profile"}</button></form>{message && <p className={error ? "notice error" : "notice"} role={error ? "alert" : "status"}>{message}</p>}</section>;
}
