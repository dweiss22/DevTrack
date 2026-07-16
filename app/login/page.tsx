"use client";
import { useState } from "react";
import { DevTrackBrand } from "@/components/devtrack-brand";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return <main className="login"><section className="card"><DevTrackBrand href="/login" className="login-brand" /><p className="eyebrow">SECURE REPORTING</p><h1>Sign in</h1><p>Sign in with the email and password supplied by your DevTrack administrator.</p><form onSubmit={async (event) => { event.preventDefault(); setSubmitting(true); setNotice(""); const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }); const body = await response.json(); setSubmitting(false); if (!response.ok) return setNotice(body.error); window.location.assign(body.redirectTo); }}><label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label><button disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button></form>{notice && <p className="notice error">{notice}</p>}</section></main>;
}
