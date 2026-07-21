import React from "react";
import { UnresolvedReferenceLabel } from "@/components/wrike-reference";
import type { NormalizedCustomFieldValue } from "@/lib/wrike/custom-field-normalization";
import type { ResolvedCustomField, ResolvedFolder } from "@/lib/wrike/metadata";
import { verticalStateLabel, type VerticalState } from "@/lib/wrike/vertical-normalization";

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

export function TaskCustomFieldList({ fields, unresolvedFields = [], verticalState, showAdminDiagnostics = false }: { fields: NormalizedCustomFieldValue[]; unresolvedFields?: ResolvedCustomField[]; verticalState?: VerticalState | null; showAdminDiagnostics?: boolean }) {
  if (!fields.length && !unresolvedFields.length) return <p>No Wrike custom-field values.</p>;
  return <>{fields.map((field) => <div key={field.normalizedKey}><p><strong>{field.normalizedTitle}:</strong> {display(field.displayValues)}{field.verticalNormalization && <> · <span>Reporting category: {verticalState ? verticalStateLabel(verticalState) : field.verticalNormalization.reportingCategory}</span>{verticalState === "synchronization_incomplete" && <span className="notice">Previously synchronized value; current Wrike data is not verified</span>}{field.verticalNormalization.hasUnresolvedVertical && <span className="notice error" title={showAdminDiagnostics ? field.verticalNormalization.rejectedTokens.join(", ") || "Vertical is missing" : "Vertical value needs review"}>Needs Vertical review</span>}</>}{field.conflict && <> <span className="notice error">Conflicting Wrike values</span></>}</p>{showAdminDiagnostics && field.verticalNormalization?.rejectedTokens.length ? <details><summary>Original unrecognized Vertical values</summary><p>{field.verticalNormalization.rejectedTokens.join(", ")}</p></details> : null}{field.conflict && <details><summary>View source fields</summary>{field.sources.map((source) => <p key={source.wrikeFieldId}><code>{source.wrikeFieldId}</code> — {source.originalTitle}: {display(source.displayValue)}</p>)}</details>}</div>)}{unresolvedFields.filter((field) => field.title.trim().toLocaleLowerCase() !== "vertical").map((field) => <p key={field.id}><strong><UnresolvedReferenceLabel id={field.id} type="custom_field" />:</strong> {display(field.rawValue)}</p>)}</>;
}
