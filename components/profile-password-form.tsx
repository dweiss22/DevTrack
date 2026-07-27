"use client";

import { useState, type FormEvent } from "react";

export function ProfilePasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError(false);

    if (password !== confirmation) {
      setError(true);
      setMessage("The passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        setError(true);
        setMessage(body.error ?? "Your password could not be updated.");
        return;
      }

      setPassword("");
      setConfirmation("");
      setMessage("Password updated. Other signed-in sessions have been signed out.");
    } catch {
      setError(true);
      setMessage("Your password could not be updated. Please retry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card profile-card">
      <h2>Change password</h2>
      <p className="muted">Use at least 12 characters. Your new password will be required the next time you sign in.</p>
      <form onSubmit={submit}>
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={submitting}
          />
        </label>
        <button type="submit" disabled={submitting}>{submitting ? "Updating…" : "Update password"}</button>
      </form>
      {message && (
        <p className={error ? "notice error" : "notice"} role={error ? "alert" : "status"} aria-live="polite">
          {message}
        </p>
      )}
    </section>
  );
}
