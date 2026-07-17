import React from "react";
import { UnresolvedReferenceLabel } from "@/components/wrike-reference";
import type { NormalizedCustomFieldValue } from "@/lib/wrike/custom-field-normalization";
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
  return folders.length ? <ul className="detail-list">{folders.map((folder) => <li key={folder.id}>{folder.resolved ? folder.title : <UnresolvedReferenceLabel id={folder.id} type="folder" />}</li>)}</ul> : <p>No folder metadata was supplied by Wrike.</p>;
}

export function TaskCustomFieldList({ fields, unresolvedFields = [] }: { fields: NormalizedCustomFieldValue[]; unresolvedFields?: ResolvedCustomField[] }) {
  if (!fields.length && !unresolvedFields.length) return <p>No Wrike custom-field values.</p>;
  return <>{fields.map((field) => <div key={field.normalizedKey}><p><strong>{field.normalizedTitle}:</strong> {display(field.displayValues)}{field.conflict && <> <span className="notice error">Conflicting Wrike values</span></>}</p>{field.conflict && <details><summary>View source fields</summary>{field.sources.map((source) => <p key={source.wrikeFieldId}><code>{source.wrikeFieldId}</code> — {source.originalTitle}: {display(source.displayValue)}</p>)}</details>}</div>)}{unresolvedFields.map((field) => <p key={field.id}><strong><UnresolvedReferenceLabel id={field.id} type="custom_field" />:</strong> {display(field.rawValue)}</p>)}</>;
}
