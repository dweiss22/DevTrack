import React from "react";
import type { ResolvedCustomField, ResolvedFolder } from "@/lib/wrike/metadata";

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

export function TaskCustomFieldList({ fields }: { fields: ResolvedCustomField[] }) {
  const resolved = fields.filter((field) => field.resolved);
  return resolved.length ? <>{resolved.map((field) => <p key={field.id}><strong>{field.title}:</strong> {display(field.displayValue)}</p>)}</> : <p>No resolved LCT custom-field values.</p>;
}
