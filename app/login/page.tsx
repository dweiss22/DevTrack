"use client";
import { useEffect, useState } from "react";
import { DevTrackBrand } from "@/components/devtrack-brand";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    if (error) setNotice(error);
  }, []);

  return <main className="login"><section className="card"><DevTrackBrand href="/login" className="login-brand" /><p className="eyebrow">SECURE REPORTING</p><h1>Sign in</h1><p>Use your Lexipol Microsoft account. First-time users will be authenticated, then sent for DevTrack access approval.</p><a className="button microsoft-button" href="/api/auth/microsoft">Continue with Microsoft</a><div className="login-divider"><span>or use administrator-issued credentials</span></div><form onSubmit={async (event) => { event.preventDefault(); setSubmitting(true); setNotice(""); try { const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }); const body = await response.json(); if (!response.ok) return setNotice(body.error); window.location.assign(body.redirectTo); } catch { setNotice("Sign-in could not be completed. Please try again."); } finally { setSubmitting(false); } }}><label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label><button disabled={submitting}>{submitting ? "Signing in..." : "Sign in"}</button></form>{notice && <p className="notice error" role="alert">{notice}</p>}</section></main>;
}
