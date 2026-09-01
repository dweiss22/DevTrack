"use client";

import React, { useState } from "react";

export function SmeProjectFolder({ smeIdentityId, initialUrl, editable }: {
  smeIdentityId: string; initialUrl: string | null; editable: boolean;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [saved, setSaved] = useState(initialUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/smes/project-folder", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ smeIdentityId, url }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The project folder link could not be saved.");
      setSaved(data.projectFolderUrl ?? ""); setUrl(data.projectFolderUrl ?? ""); setMessage("Saved.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The project folder link could not be saved.");
    } finally { setSaving(false); }
  }

  if (!editable) {
    return saved
      ? <a className="button secondary" href={saved} target="_blank" rel="noopener noreferrer">Project Folder</a>
      : null;
  }

  return <div className="sme-project-folder-editor">
    {saved && <a className="button secondary" href={saved} target="_blank" rel="noopener noreferrer">Project Folder</a>}
    <label className="sr-only" htmlFor="sme-project-folder-url">SME project folder URL</label>
    <input id="sme-project-folder-url" type="url" placeholder="https://…sharepoint.com/…"
      value={url} onChange={(event) => setUrl(event.target.value)} />
    <button type="button" className="button secondary" onClick={save} disabled={saving}>
      {saving ? "Saving…" : "Save folder link"}
    </button>
    {message && <span className="muted">{message}</span>}
  </div>;
}
