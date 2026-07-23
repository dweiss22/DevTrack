"use client";

import { useMemo, useState } from "react";

export type ImportConflictSource = {
  wrikeFieldId?: string;
  originalTitle?: string;
  displayValue?: unknown;
  displayValues?: string[];
};

export type ImportConflict = {
  task_id: string;
  normalized_field_id: string;
  display_values: string[];
  source_wrike_field_ids: string[];
  source_titles: string[];
  source_values: ImportConflictSource[] | unknown;
  conflict_metadata: { distinctValueSets?: { wrikeFieldId?: string; values?: string[] }[] } | null;
  synced_at: string;
  task: {
    id: string;
    wrike_id: string;
    title: string;
    status: string;
    permalink: string | null;
    updated_at_wrike: string | null;
  };
  normalized_field: {
    id: string;
    normalized_key: string;
    title: string;
  };
};

export function ImportConflictReview({ conflicts, totalCount, loadError }: {
  conflicts: ImportConflict[];
  totalCount: number;
  loadError: string | null;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleConflicts = useMemo(() => conflicts.filter((conflict) => {
    if (!normalizedQuery) return true;
    return [
      conflict.task.title,
      conflict.task.wrike_id,
      conflict.normalized_field.title,
      ...conflict.display_values,
      ...conflict.source_titles,
      ...conflict.source_wrike_field_ids,
      ...sourceRows(conflict).flatMap((source) => [source.title, source.fieldId, ...source.values])
    ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  }), [conflicts, normalizedQuery]);

  if (loadError) {
    return <p className="notice error" role="alert">Import conflicts could not be loaded: {loadError}</p>;
  }

  return <div className="admin-section-content import-conflict-workspace">
    <div className="import-conflict-guidance">
      <p><strong>How to clear a conflict:</strong> open the task in Wrike, make the listed source fields agree, then run the folder import again. DevTrack will remove the conflict automatically when the synchronized values match.</p>
      <p className="muted">This workspace is review-only. It does not overwrite Wrike or choose one source value on your behalf.</p>
      <p><a href="#data-import">Go to import and repair actions</a></p>
    </div>
    {conflicts.length ? <>
      <label className="import-conflict-search">
        <span>Find a conflict</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search project, field, value, or Wrike ID" />
      </label>
      {totalCount > conflicts.length ? <p className="notice">Showing the newest {conflicts.length} of {totalCount} current conflicts. Additional records will appear as conflicts are corrected and re-imported.</p> : null}
      <p className="muted" role="status">{visibleConflicts.length} conflict{visibleConflicts.length === 1 ? "" : "s"} shown</p>
      <div className="import-conflict-list">
        {visibleConflicts.map((conflict) => <ImportConflictCard key={`${conflict.task_id}-${conflict.normalized_field_id}`} conflict={conflict} />)}
      </div>
      {!visibleConflicts.length ? <p className="empty">No current conflicts match that search.</p> : null}
    </> : <p className="empty">No current import conflicts. Synchronized source fields agree.</p>}
  </div>;
}

function ImportConflictCard({ conflict }: { conflict: ImportConflict }) {
  const sources = sourceRows(conflict);
  const wrikeUrl = safeWrikeUrl(conflict.task.permalink);
  return <article className="card import-conflict-card">
    <div className="import-conflict-heading">
      <div>
        <p className="eyebrow">CONFLICTING IMPORTED VALUES</p>
        <h3>{conflict.task.title}</h3>
        <p className="muted">{conflict.task.status} · Wrike task <code>{conflict.task.wrike_id}</code></p>
      </div>
      <span className="notice error">{conflict.normalized_field.title}</span>
    </div>
    <p>DevTrack received different values for fields normalized as <strong>{conflict.normalized_field.title}</strong>. The combined value is <strong>{displayValues(conflict.display_values)}</strong>, but reporting and assignment workflows may exclude this field until the source values agree.</p>
    <div className="admin-table-wrap">
      <table>
        <thead><tr><th>Wrike source field</th><th>Value received</th><th>Field ID</th></tr></thead>
        <tbody>{sources.map((source, index) => <tr key={`${source.fieldId}-${index}`}><td>{source.title}</td><td>{displayValues(source.values)}</td><td><code>{source.fieldId}</code></td></tr>)}</tbody>
      </table>
    </div>
    <div className="filter-bar compact">
      <a className="button secondary" href={`/projects/${conflict.task_id}`}>Review DevTrack project</a>
      {wrikeUrl ? <a className="button secondary" href={wrikeUrl} target="_blank" rel="noreferrer">Open task in Wrike</a> : null}
    </div>
    <p className="muted">Conflict last synchronized {formatDate(conflict.synced_at)}.</p>
  </article>;
}

function sourceRows(conflict: ImportConflict) {
  const valuesById = new Map<string, string[]>();
  const metadata = conflict.conflict_metadata?.distinctValueSets ?? [];
  for (const item of metadata) {
    if (item.wrikeFieldId) valuesById.set(item.wrikeFieldId, stringValues(item.values));
  }
  const persistedSources = Array.isArray(conflict.source_values) ? conflict.source_values as ImportConflictSource[] : [];
  return conflict.source_wrike_field_ids.map((fieldId, index) => {
    const persisted = persistedSources.find((source) => source?.wrikeFieldId === fieldId) ?? persistedSources[index];
    return {
      fieldId,
      title: persisted?.originalTitle || conflict.source_titles[index] || "Untitled Wrike field",
      values: persisted?.displayValues?.length
        ? stringValues(persisted.displayValues)
        : valuesById.get(fieldId) ?? stringValues(persisted?.displayValue)
    };
  });
}

function stringValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (value == null || value === "") return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [String(value)];
  return [JSON.stringify(value)];
}

function displayValues(values: string[]) {
  return values.length ? values.join(", ") : "Not set";
}

function safeWrikeUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "wrike.com" || url.hostname.endsWith(".wrike.com")) ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
