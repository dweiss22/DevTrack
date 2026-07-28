import React from "react";

export function SurveyReceived({ submittedAt, compact = false }: {
  submittedAt: string | null | undefined;
  compact?: boolean;
}) {
  return <div className={`survey-received${compact ? " compact" : ""}`} role="status">
    <strong>Survey received</strong>
    <span>{submittedAt ? `Submitted ${formatSubmissionTime(submittedAt)}` : "Submission time unavailable"}</span>
  </div>;
}

function formatSubmissionTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
