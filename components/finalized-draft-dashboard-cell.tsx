"use client";

import { useState } from "react";
import { finalizedCourseDraftUrlSchema, type FinalizedDraftStatus } from "@/lib/projects/finalized-draft";

export function FinalizedDraftDashboardCell({ taskId, initial }: {
  taskId: string;
  initial: FinalizedDraftStatus;
}) {
  const [status, setStatus] = useState(initial);
  const [mode, setMode] = useState<"view" | "loading" | "editing">("view");
  const [url, setUrl] = useState(initial.url ?? "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function openEditor() {
    setMode("loading"); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/projects/${taskId}/finalized-draft`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The link could not be loaded.");
      setStatus(payload);
      setUrl(payload.url ?? "");
      setMode("editing");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The link could not be loaded.");
      setMode("view");
    }
  }

  function cancel() {
    setMode("view"); setError(""); setMessage(""); setUrl(status.url ?? "");
  }

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
      setMessage("Link saved.");
      setMode("view");
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
      setMessage("Link removed.");
      setMode("view");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The link could not be removed.");
    } finally {
      setSaving(false);
    }
  }

  if (mode === "view" || mode === "loading") {
    return <>{status.available ? "Available" : "Not available"}<br />
      <button type="button" className="link-button" onClick={openEditor} disabled={mode === "loading"}>
        {mode === "loading" ? "Loading…" : status.available ? "Edit link" : "Add link"}
      </button>
      {error ? <p className="field-error-message" role="alert">{error}</p> : null}
    </>;
  }

  return <div className="finalized-draft-inline-editor">
    <label className={error ? "field-error" : undefined}>
      <span className="sr-only">Finalized course draft link</span>
      <input type="url" inputMode="url" placeholder="https://…" value={url} maxLength={2048}
        onChange={(event) => setUrl(event.target.value)}
        aria-describedby={error ? `finalized-draft-error-${taskId}` : undefined} />
    </label>
    {error ? <p className="field-error-message" id={`finalized-draft-error-${taskId}`} role="alert">{error}</p> : null}
    {message ? <p className="notice" role="status">{message}</p> : null}
    <div className="filter-bar">
      <button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : status.available ? "Update" : "Save"}</button>
      {status.available ? <button type="button" className="secondary danger" onClick={remove} disabled={saving}>Remove</button> : null}
      <button type="button" className="secondary" onClick={cancel} disabled={saving}>Cancel</button>
    </div>
  </div>;
}
