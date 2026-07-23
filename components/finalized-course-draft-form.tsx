"use client";

import { useState } from "react";
import { finalizedCourseDraftUrlSchema, type FinalizedDraftStatus } from "@/lib/projects/finalized-draft";

export function FinalizedCourseDraftForm({ taskId, initial }: {
  taskId: string;
  initial: FinalizedDraftStatus;
}) {
  const [status, setStatus] = useState(initial);
  const [url, setUrl] = useState(initial.url ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setMessage(""); setError("");
    const parsed = finalizedCourseDraftUrlSchema.safeParse(url);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid finalized course draft link.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/projects/${taskId}/finalized-draft`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: parsed.data }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The link could not be saved.");
      setStatus(payload);
      setUrl(payload.url ?? parsed.data);
      setMessage("Finalized course draft link saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The link could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Remove the finalized course draft link from this project?")) return;
    setSaving(true); setMessage(""); setError("");
    try {
      const response = await fetch(`/api/projects/${taskId}/finalized-draft`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The link could not be removed.");
      setStatus(payload);
      setUrl("");
      setMessage("Finalized course draft link removed.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The link could not be removed.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="card finalized-draft-editor" id="finalized-draft" aria-labelledby="finalized-draft-heading">
    <div><p className="eyebrow">ASSIGNED ID ACTION</p><h2 id="finalized-draft-heading">Finalized course draft link</h2>
      <p>Provide the secure HTTPS destination that the assigned SME may use to review the finalized course draft.</p></div>
    <p><strong>Availability:</strong> {status.available ? "Available to assigned SMEs" : "Not available"}
      {status.updatedAt ? <><br /><span className="muted">Last updated {new Date(status.updatedAt).toLocaleString()}{status.updatedBy ? ` by ${status.updatedBy}` : ""}</span></> : null}</p>
    <label className={error ? "field-error" : undefined}><span>Finalized course draft link</span>
      <input type="url" inputMode="url" placeholder="https://…" value={url} maxLength={2048}
        onChange={(event) => setUrl(event.target.value)} aria-describedby={error ? "finalized-draft-error" : undefined} />
    </label>
    {error ? <p className="field-error-message" id="finalized-draft-error" role="alert">{error}</p> : null}
    {message ? <p className="notice" role="status">{message}</p> : null}
    <div className="filter-bar">
      <button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : status.available ? "Update link" : "Save link"}</button>
      {status.available ? <button type="button" className="secondary danger" onClick={remove} disabled={saving}>Remove link</button> : null}
    </div>
  </section>;
}
