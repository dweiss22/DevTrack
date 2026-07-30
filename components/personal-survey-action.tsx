"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PersonalSurveyAction({
  taskId,
  reviewedSmeIdentityId,
  reviewedWrikeUserId,
  label,
  returnTo,
}: {
  taskId: string;
  reviewedSmeIdentityId: string | null;
  reviewedWrikeUserId: string | null;
  label: string;
  returnTo: string;
}) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setWorking(true); setError("");
    try {
      const response = await fetch("/api/surveys", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId,
          reviewedSmeIdentityId,
          reviewedWrikeUserId,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Survey is unavailable.");
      router.push(`/surveys/${payload.id}?returnTo=${encodeURIComponent(returnTo)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Survey is unavailable.");
      setWorking(false);
    }
  }

  return <div className="personal-survey-action">
    <button type="button" className="secondary" disabled={working} onClick={() => void start()}>
      {working ? "Opening…" : label}
    </button>
    {error && <span className="field-error-message" role="alert">{error}</span>}
  </div>;
}
