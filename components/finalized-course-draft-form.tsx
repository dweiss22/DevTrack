"use client";

import { useState } from "react";
import { LinkFieldEditor } from "@/components/link-field-editor";
import { finalizedCourseDraftUrlSchema, type FinalizedDraftStatus } from "@/lib/projects/finalized-draft";

export function FinalizedCourseDraftForm({ taskId, initial }: {
  taskId: string;
  initial: FinalizedDraftStatus;
}) {
  const [status, setStatus] = useState(initial);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(url: string) {
    setMessage(""); setError("");
    const parsed = finalizedCourseDraftUrlSchema.safeParse(url);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid finalized course draft link.");
      return false;
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
      setMessage("Finalized course draft link saved.");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The link could not be saved.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Remove the finalized course draft link from this project?")) return false;
    setSaving(true); setMessage(""); setError("");
    try {
      const response = await fetch(`/api/projects/${taskId}/finalized-draft`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The link could not be removed.");
      setStatus(payload);
      setMessage("Finalized course draft link removed.");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The link could not be removed.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return <section className="card finalized-draft-editor" id="finalized-draft" aria-labelledby="finalized-draft-heading">
    <div><p className="eyebrow">ASSIGNED ID ACTION</p><h2 id="finalized-draft-heading">Finalized course draft link</h2>
      <p>Provide the secure HTTPS destination that the assigned SME may use to review the finalized course draft.</p></div>
    <p><strong>Availability:</strong> {status.available ? "Available to assigned SMEs" : "Not available"}
      {status.updatedAt ? <><br /><span className="muted">Last updated {new Date(status.updatedAt).toLocaleString()}{status.updatedBy ? ` by ${status.updatedBy}` : ""}</span></> : null}</p>
    <LinkFieldEditor url={status.url ?? null} editable label="Finalized course draft" addLabel="Add finalized course draft link"
      saving={saving} onSave={save} onRemove={remove} />
    {error ? <p className="field-error-message" role="alert">{error}</p> : null}
    {message ? <p className="notice" role="status">{message}</p> : null}
  </section>;
}
