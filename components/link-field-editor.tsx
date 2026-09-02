"use client";

import { useState } from "react";

export function LinkFieldEditor({
  url, editable, label, addLabel, placeholder = "https://…", saving, onSave, onRemove,
}: {
  url: string | null;
  editable: boolean;
  label: string;
  addLabel: string;
  placeholder?: string;
  saving: boolean;
  onSave: (url: string) => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(url ?? "");

  if (!editable) {
    return url ? <a className="button secondary link-field-button" href={url} target="_blank" rel="noopener noreferrer">{label}</a> : null;
  }

  if (!editing) {
    return <div className="link-field-editor">
      {url
        ? <a className="button secondary link-field-button" href={url} target="_blank" rel="noopener noreferrer">{label}</a>
        : <button type="button" className="secondary link-field-add" onClick={() => { setDraft(""); setEditing(true); }}>{addLabel}</button>}
      {url && <button type="button" className="link-field-edit-icon" aria-label={`Edit ${label}`}
        onClick={() => { setDraft(url); setEditing(true); }}>✎</button>}
    </div>;
  }

  return <div className="link-field-editor link-field-editing">
    <label className="sr-only" htmlFor={`link-field-${label}`}>{label}</label>
    <input id={`link-field-${label}`} type="url" value={draft} placeholder={placeholder} autoFocus disabled={saving}
      onChange={(event) => setDraft(event.target.value)} />
    <button type="button" className="secondary" disabled={saving || !draft.trim()}
      onClick={async () => { if (await onSave(draft.trim())) setEditing(false); }}>
      {saving ? "Saving…" : "Save"}
    </button>
    <button type="button" className="secondary" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
    {url && onRemove ? <button type="button" className="secondary danger" disabled={saving}
      onClick={async () => { if (await onRemove()) setEditing(false); }}>Remove</button> : null}
  </div>;
}
