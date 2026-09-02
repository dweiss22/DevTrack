"use client";

import { useState } from "react";
import { LinkFieldEditor } from "@/components/link-field-editor";

export function SmeProjectFolder({ smeIdentityId, initialUrl, editable }: {
  smeIdentityId: string; initialUrl: string | null; editable: boolean;
}) {
  const [saved, setSaved] = useState(initialUrl);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save(url: string) {
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/smes/project-folder", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ smeIdentityId, url }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The project folder link could not be saved.");
      setSaved(data.projectFolderUrl ?? null); setMessage("Saved.");
      return true;
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The project folder link could not be saved.");
      return false;
    } finally { setSaving(false); }
  }

  return <div className="sme-project-folder-editor">
    <LinkFieldEditor url={saved} editable={editable} label="Project Folder" addLabel="Add project folder link"
      saving={saving} onSave={save} />
    {message && <span className="muted">{message}</span>}
  </div>;
}
