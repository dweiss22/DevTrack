"use client";

import { useState } from "react";

export function SurveyInvoiceDownloadButton({ submissionId, attachmentId }: {
  submissionId: string;
  attachmentId: string;
}) {
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  async function download() {
    setWorking(true); setError("");
    try {
      const response = await fetch(`/api/surveys/${submissionId}/invoice/${attachmentId}/download`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The invoice download could not be prepared.");
      window.location.assign(payload.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The invoice download could not be prepared.");
    } finally {
      setWorking(false);
    }
  }

  return <span>
    <button type="button" className="link-button" onClick={download} disabled={working}>
      {working ? "Preparing…" : "Download invoice"}
    </button>
    {error ? <span className="field-error-message" role="alert">{error}</span> : null}
  </span>;
}
