import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ProjectTimeAnalytics } from "@/components/project-time-analytics";
import { TaskCustomFieldList, TaskFolderList } from "@/components/task-metadata";
import { StatusBadge, UnresolvedReferenceLabel } from "@/components/wrike-reference";
import { requireContext } from "@/lib/auth";
import { hours } from "@/lib/metrics";
import { safeProjectsReturnTo } from "@/lib/reporting/dashboard-navigation";
import { projectTimeMetrics, type ProjectTimeEntry } from "@/lib/reporting/project-time";
import { extractFieldYear, projectContactValues, projectFieldRole, type ProjectPersonOption } from "@/lib/reporting/projects";
import { mergeNormalizedCustomFields, type NormalizedCustomFieldValue } from "@/lib/wrike/custom-field-normalization";
import type { ResolvedCustomField, ResolvedFolder } from "@/lib/wrike/metadata";
import { resolveResponsibleUsers, resolveTaskStatus, resolveTimelogCategory } from "@/lib/wrike/reference-data";
import { normalizeVerticalValue, verticalStateLabel, type VerticalState } from "@/lib/wrike/vertical-normalization";

type ProjectDetailRow = {
  wrike_id: string; title: string; status: string; custom_status_id: string | null; responsible_wrike_ids: string[];
  description: string | null; permalink: string | null; created_at_wrike: string | null; updated_at_wrike: string | null;
  start_date: string | null; due_date: string | null; completed_at: string | null;
  planned_minutes: number | null; allocated_minutes: number | null; raw_data: unknown;
  vertical_state: VerticalState | null; custom_fields_sync_state: string | null; custom_fields_verified_at: string | null;
  enriched_metadata: { folders?: ResolvedFolder[]; customFields?: ResolvedCustomField[]; customFieldsNormalized?: NormalizedCustomFieldValue[] } | null;
  wrike_time_entries: { id: string; wrike_id: string; entry_date: string; minutes: number; category: string | null; comment: string | null; user_wrike_id: string | null; wrike_users: { display_name: string; email: string | null } | null }[];
};

export default async function ProjectDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const returnTo = safeProjectsReturnTo(query.returnTo) ?? "/projects";
  const returnLabel = returnTo.startsWith("/development") ? "Development" : "Projects";
  const { supabase, profile } = await requireContext();
  const [projectResult, usersResult, categoriesResult, statusesResult, verticalResult] = await Promise.all([
    supabase.from("wrike_tasks").select("*,wrike_time_entries(id,wrike_id,entry_date,minutes,category,comment,user_wrike_id,wrike_users(display_name,email))").eq("id", id).eq("organization_id", profile.organization_id).maybeSingle(),
    supabase.from("wrike_users").select("wrike_id,display_name,email,avatar_url,synced_at,is_active,is_unresolved,raw_data").eq("organization_id", profile.organization_id),
    supabase.from("wrike_timelog_categories").select("wrike_id,title,synced_at,is_unresolved").eq("organization_id", profile.organization_id),
    supabase.from("wrike_workflow_statuses").select("wrike_id,title,workflow_id,color,dashboard_classification,synced_at,is_unresolved").eq("organization_id", profile.organization_id),
    supabase.from("wrike_task_normalized_custom_field_values").select("normalized_verticals,vertical_reporting_category,has_unresolved_vertical,unresolved_vertical_tokens,has_conflict,source_wrike_field_ids,source_titles,normalized_field:wrike_normalized_custom_fields!inner(normalized_key)").eq("task_id", id).eq("normalized_field.normalized_key", "vertical").maybeSingle()
  ]);
  for (const result of [projectResult, usersResult, categoriesResult, statusesResult, verticalResult]) if (result.error) throw result.error;
  if (!projectResult.data) notFound();
  const row = projectResult.data as unknown as ProjectDetailRow;
  const users = usersResult.data ?? [];
  const categories = categoriesResult.data ?? [];
  const folders = row.enriched_metadata?.folders ?? [];
  const customFieldsRaw = row.enriched_metadata?.customFields ?? [];
  const mergedCustomFields = row.enriched_metadata?.customFieldsNormalized ?? mergeNormalizedCustomFields(customFieldsRaw);
  const verticalRow = verticalResult.data;
  const canonicalVertical = verticalRow ? canonicalVerticalField(verticalRow, row.vertical_state) : null;
  const customFields = canonicalVertical ? [...mergedCustomFields.filter((field) => field.normalizedKey !== "vertical"), canonicalVertical] : mergedCustomFields;
  const unresolvedCustomFields = customFieldsRaw.filter((field) => !field.resolved && !field.ignored);
  const assignees = resolveResponsibleUsers(row.responsible_wrike_ids ?? [], users);
  const statusReference = resolveTaskStatus(row.custom_status_id, row.status, statusesResult.data ?? []);
  const people: ProjectPersonOption[] = users.map((person) => ({ wrikeId: person.wrike_id, name: person.display_name, resolved: !person.is_unresolved && person.display_name !== person.wrike_id }));
  const fieldByRole = new Map(customFields.map((field) => [projectFieldRole(field.normalizedKey), field]).filter((entry): entry is [NonNullable<ReturnType<typeof projectFieldRole>>, NormalizedCustomFieldValue] => entry[0] != null));
  const vertical = fieldByRole.get("vertical");
  const featuredRoles = new Set([...fieldByRole.values()].map((field) => field.normalizedKey));
  const otherFields = customFields.filter((field) => !featuredRoles.has(field.normalizedKey));
  const timeEntries = row.wrike_time_entries.map((entry): ProjectTimeEntry => {
    const person = entry.user_wrike_id ? resolveResponsibleUsers([entry.user_wrike_id], users)[0] : null;
    const category = resolveTimelogCategory(entry.category, categories);
    return {
      id: entry.id,
      sourceId: entry.wrike_id,
      date: entry.entry_date,
      minutes: entry.minutes,
      contributorId: person?.wrikeUserId ?? entry.user_wrike_id ?? "unknown",
      contributorName: person?.fullName ?? entry.wrike_users?.display_name ?? "Unknown contributor",
      contributorResolved: person?.resolved ?? Boolean(entry.wrike_users?.display_name),
      categoryId: category?.wrikeCategoryId ?? entry.category ?? "uncategorized",
      categoryName: category?.name ?? "Uncategorized",
      categoryResolved: category?.resolved ?? entry.category == null,
      comment: entry.comment
    };
  }).sort((left, right) => right.date.localeCompare(left.date));
  const metrics = projectTimeMetrics(timeEntries);
  const reportingYear = extractFieldYear(fieldByRole.get("reporting")?.displayValues ?? []);

  return <AppShell isAdmin={profile.role === "admin"}>
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link href={returnTo}>{returnLabel}</Link><span aria-hidden="true">/</span><span aria-current="page">Project detail</span></nav>
    <header className="page-header project-detail-header"><div><p className="eyebrow">PROJECT DETAIL</p><h1>{row.title}</h1><p><StatusBadge name={statusReference.name} id={row.custom_status_id} color={statusReference.color} resolved={statusReference.resolved} /> <span aria-hidden="true">·</span> Due {formatDate(row.due_date)}</p></div>{row.permalink && <a className="button" href={row.permalink} target="_blank" rel="noreferrer">Open in Wrike</a>}</header>

    {row.custom_fields_sync_state !== "complete" && <p className="notice project-sync-notice" role="status">Some custom-field data is not currently verified. Previously synchronized values are labeled below and have not been replaced with empty data.</p>}

    <section className="card project-overview-card" aria-labelledby="project-overview-heading">
      <div className="section-heading"><div><p className="eyebrow">OVERVIEW</p><h2 id="project-overview-heading">Project information</h2></div>{row.description && <p>{row.description}</p>}</div>
      <dl className="project-metadata-grid">
        <MetadataItem label="Status"><StatusBadge name={statusReference.name} id={row.custom_status_id} color={statusReference.color} resolved={statusReference.resolved} /></MetadataItem>
        <MetadataItem label="Reporting year">{reportingYear ?? fieldValue(fieldByRole.get("reporting"), people)}{reportingYear && fieldByRole.get("reporting")?.conflict && <ConflictBadge />}</MetadataItem>
        <MetadataItem label="Owner / Instructional Designer">{fieldValue(fieldByRole.get("owner"), people, true)}</MetadataItem>
        <MetadataItem label="Authoring tool">{fieldValue(fieldByRole.get("tool"), people)}</MetadataItem>
        <MetadataItem label="Course type">{fieldValue(fieldByRole.get("courseType"), people)}</MetadataItem>
        <MetadataItem label="Associated Vertical">{vertical?.displayValues.length ? vertical.displayValues.join(", ") : "Not assigned"}{vertical?.conflict && <ConflictBadge />}</MetadataItem>
        <MetadataItem label="Vertical reporting category">{row.vertical_state ? verticalStateLabel(row.vertical_state) : vertical?.verticalNormalization?.reportingCategory ?? "Not available"}</MetadataItem>
        <MetadataItem label="SME">{fieldValue(fieldByRole.get("sme"), people, true)}</MetadataItem>
        <MetadataItem label="Course length">{fieldValue(fieldByRole.get("courseLength"), people)}</MetadataItem>
        <MetadataItem label="Assigned users">{assignees.length ? assignees.map((person, index) => <React.Fragment key={person.wrikeUserId}>{index > 0 && ", "}{person.resolved ? person.fullName : <UnresolvedReferenceLabel id={person.wrikeUserId} type="user" />}</React.Fragment>) : "Unassigned"}</MetadataItem>
        <MetadataItem label="Planned effort">{row.planned_minutes == null ? "Not available" : `${hours(row.planned_minutes)} hours`}</MetadataItem>
        <MetadataItem label="Allocated effort">{row.allocated_minutes == null ? "Not available" : `${hours(row.allocated_minutes)} hours`}</MetadataItem>
      </dl>
      {profile.role === "admin" && vertical?.verticalNormalization?.rejectedTokens.length ? <details className="project-vertical-diagnostics"><summary>Original unrecognized Vertical values</summary><p>{vertical.verticalNormalization.rejectedTokens.join(", ")}</p></details> : null}
    </section>

    <div className="project-detail-grid">
      <section className="card"><h2>Project dates</h2><dl className="project-detail-list"><MetadataItem label="Created">{formatDate(row.created_at_wrike, true)}</MetadataItem><MetadataItem label="Start">{formatDate(row.start_date)}</MetadataItem><MetadataItem label="Due">{formatDate(row.due_date)}</MetadataItem><MetadataItem label="Completed">{formatDate(row.completed_at, true)}</MetadataItem><MetadataItem label="Last updated">{formatDate(row.updated_at_wrike, true)}</MetadataItem></dl></section>
      <section className="card"><h2>Wrike folders</h2><TaskFolderList folders={folders} /></section>
      <section className="card project-other-fields"><h2>Other synchronized fields</h2><TaskCustomFieldList fields={otherFields} unresolvedFields={unresolvedCustomFields} verticalState={row.vertical_state} showAdminDiagnostics={profile.role === "admin"} /></section>
    </div>

    <section className={`project-time-metrics ${row.planned_minutes == null ? "three" : ""}`} aria-label="Project time summary">
      <article className="card"><p>Total recorded time</p><strong>{hours(metrics.minutes)} h</strong></article>
      <article className="card"><p>Time entries</p><strong>{metrics.entries.toLocaleString()}</strong></article>
      <article className="card"><p>Contributors</p><strong>{metrics.contributors.toLocaleString()}</strong></article>
      {row.planned_minutes != null && <article className="card"><p>Planned vs. actual</p><strong>{hours(row.planned_minutes)} h <span>/ {hours(metrics.minutes)} h</span></strong><small>{row.planned_minutes >= metrics.minutes ? `${hours(row.planned_minutes - metrics.minutes)} h remaining` : `${hours(metrics.minutes - row.planned_minutes)} h over plan`}</small></article>}
    </section>

    <ProjectTimeAnalytics entries={timeEntries} plannedMinutes={row.planned_minutes} />

    <section className="card project-time-table-card"><div className="section-heading"><div><p className="eyebrow">TIME ENTRIES</p><h2>Visible time-entry detail</h2></div><p>{metrics.entries.toLocaleString()} entr{metrics.entries === 1 ? "y" : "ies"}</p></div>{timeEntries.length ? <div className="project-time-table-wrap"><table><thead><tr><th>Date</th><th>Person</th><th>Category</th><th>Hours</th><th>Comment</th><th>Source</th></tr></thead><tbody>{timeEntries.map((entry) => <tr key={entry.id}><td>{formatDate(entry.date)}</td><td>{entry.contributorResolved ? entry.contributorName : <UnresolvedReferenceLabel id={entry.contributorId} type="user" label="Unresolved contributor" />}</td><td>{entry.categoryResolved ? entry.categoryName : <UnresolvedReferenceLabel id={entry.categoryId} type="timelog_category" label="Unresolved category" />}</td><td>{hours(entry.minutes)}</td><td>{entry.comment ?? "—"}</td><td><code title={entry.sourceId}>Wrike {entry.sourceId}</code></td></tr>)}</tbody></table></div> : <p className="empty">No visible recorded time exists for this project.</p>}</section>

    {profile.role === "admin" && <section className="card project-admin-source"><h2>Administrator: synchronization evidence</h2><p><strong>Wrike task ID:</strong> <code>{row.wrike_id}</code><br /><strong>Custom-field state:</strong> {row.custom_fields_sync_state ?? "unknown"}<br /><strong>Verified:</strong> {formatDate(row.custom_fields_verified_at, true)}</p><p><strong>Responsible users:</strong> {assignees.length ? assignees.map((person) => person.fullName).join(", ") : "None"}</p><details><summary>View original identifiers and source payload</summary><p><strong>Responsible IDs:</strong> {(row.responsible_wrike_ids ?? []).join(", ") || "None"}<br /><strong>Custom status ID:</strong> {row.custom_status_id ?? "None"}</p><h3>Resolved and unresolved raw custom fields</h3><pre>{JSON.stringify(customFieldsRaw, null, 2)}</pre><h3>Original task response</h3><pre>{JSON.stringify(row.raw_data, null, 2)}</pre></details></section>}
  </AppShell>;
}

function MetadataItem({ label, children }: { label: string; children: React.ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }
function ConflictBadge() { return <span className="metadata-warning">Conflicting sources</span>; }

function fieldValue(field: NormalizedCustomFieldValue | undefined, people: ProjectPersonOption[], contact = false): React.ReactNode {
  if (!field?.displayValues.length) return "Not available";
  const values = contact ? projectContactValues(field.displayValues, people) : field.displayValues.map((value) => ({ id: value, label: value, resolved: true }));
  return <>{values.map((value, index) => <React.Fragment key={`${field.normalizedKey}-${value.id}`}>{index > 0 && ", "}{value.resolved ? value.label : <UnresolvedReferenceLabel id={value.id} type="user" label="Unresolved user" />}</React.Fragment>)}{field.conflict && <ConflictBadge />}</>;
}

function canonicalVerticalField(row: { normalized_verticals: string[] | null; vertical_reporting_category: string | null; has_unresolved_vertical: boolean | null; unresolved_vertical_tokens: string[] | null; has_conflict: boolean | null; source_wrike_field_ids: string[] | null; source_titles: string[] | null }, state: VerticalState | null): NormalizedCustomFieldValue {
  const normalized = row.normalized_verticals ?? [];
  const base = normalizeVerticalValue(normalized);
  return {
    normalizedKey: "vertical",
    normalizedTitle: "Vertical",
    displayValues: normalized,
    sourceFieldIds: row.source_wrike_field_ids ?? [],
    sourceTitles: row.source_titles ?? [],
    sources: [],
    conflict: row.has_conflict ?? false,
    conflictMetadata: null,
    verticalNormalization: {
      ...base,
      normalizedVerticals: normalized as typeof base.normalizedVerticals,
      reportingCategory: (row.vertical_reporting_category ?? base.reportingCategory) as typeof base.reportingCategory,
      hasUnresolvedVertical: state ? ["missing", "unrecognized", "synchronization_incomplete"].includes(state) : row.has_unresolved_vertical ?? base.hasUnresolvedVertical,
      rejectedTokens: row.unresolved_vertical_tokens ?? []
    }
  };
}

function formatDate(value: string | null, includeTime = false) {
  if (!value) return "Not available";
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return new Intl.DateTimeFormat("en-US", includeTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium", timeZone: "UTC" }).format(date);
}
