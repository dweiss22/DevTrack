import React from "react";
import type { ResolvedFolder } from "@/lib/wrike/metadata";
import type { NormalizedCustomFieldValue } from "@/lib/wrike/custom-field-normalization";

export function taskFolderLabels(folders: ResolvedFolder[]) {
  return [...new Set(folders.map((folder) => folder.resolved ? folder.title : folder.id))];
}

function display(value: unknown) {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join(", ");
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);
}

export function TaskFolderList({ folders }: { folders: ResolvedFolder[] }) {
  const labels = taskFolderLabels(folders);
  return labels.length ? <ul className="detail-list">{labels.map((label) => <li key={label}>{label}</li>)}</ul> : <p>No folder metadata was supplied by Wrike.</p>;
}

export function TaskCustomFieldList({ fields }: { fields: NormalizedCustomFieldValue[] }) {
  return fields.length ? <>{fields.map((field) => <div key={field.normalizedKey}><p><strong>{field.normalizedTitle}:</strong> {display(field.displayValues)}{field.conflict && <> <span className="notice error">Conflicting Wrike values</span></>}</p>{field.conflict && <details><summary>View source fields</summary>{field.sources.map((source) => <p key={source.wrikeFieldId}><code>{source.wrikeFieldId}</code> — {source.originalTitle}: {display(source.displayValue)}</p>)}</details>}</div>)}</> : <p>No resolved LCT custom-field values.</p>;
}
