"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function ImpersonationBanner({ effectiveName, actorName, lastActivityAt, absoluteExpiresAt }: {
  effectiveName: string;
  actorName: string;
  lastActivityAt: string;
  absoluteExpiresAt: string;
}) {
  const [ending, setEnding] = useState(false);
  const [activityAt, setActivityAt] = useState(() => new Date(lastActivityAt).getTime());
  const [now, setNow] = useState(Date.now());
  const lastHeartbeat = useRef(0);
  const expiresAt = Math.min(activityAt + 15 * 60_000, new Date(absoluteExpiresAt).getTime());
  const remaining = Math.max(0, expiresAt - now);
  const exit = useCallback(async () => {
    if (ending) return;
    setEnding(true);
    await fetch("/api/impersonations/current", { method: "DELETE" }).catch(() => null);
    window.location.assign("/");
  }, [ending]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => { if (remaining === 0) void exit(); }, [remaining, exit]);
  useEffect(() => {
    async function activity() {
      const timestamp = Date.now();
      if (timestamp - lastHeartbeat.current < 30_000) return;
      lastHeartbeat.current = timestamp;
      const response = await fetch("/api/impersonations/activity", { method: "POST" }).catch(() => null);
      if (response?.ok) {
        const payload = await response.json() as { lastActivityAt?: string };
        if (payload.lastActivityAt) setActivityAt(new Date(payload.lastActivityAt).getTime());
      }
    }
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart"];
    events.forEach((event) => window.addEventListener(event, activity, { passive: true }));
    return () => events.forEach((event) => window.removeEventListener(event, activity));
  }, []);

  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return <div className="impersonation-banner" role="status">
    <p><strong>You are viewing DevTrack as {effectiveName}.</strong> Actions are recorded as performed by {actorName}.
      <span className="impersonation-time"> Expires in {minutes}:{String(seconds).padStart(2, "0")}.</span></p>
    <button type="button" className="secondary" onClick={exit} disabled={ending}>{ending ? "Exiting…" : "Exit impersonation"}</button>
  </div>;
}
