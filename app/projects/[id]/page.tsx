import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TaskCustomFieldList, TaskFolderList } from "@/components/task-metadata";
import { StatusBadge, UnresolvedReferenceLabel } from "@/components/wrike-reference";
import { requireContext } from "@/lib/auth";
import { hours } from "@/lib/metrics";
import { mergeNormalizedCustomFields, type NormalizedCustomFieldValue } from "@/lib/wrike/custom-field-normalization";
import type { ResolvedCustomField, ResolvedFolder } from "@/lib/wrike/metadata";
import { resolveResponsibleUsers, resolveTaskStatus, resolveTimelogCategory } from "@/lib/wrike/reference-data";
import { safeProjectsReturnTo } from "@/lib/reporting/dashboard-navigation";

type ProjectDetailRow = {
  title: string; status: string; custom_status_id: string | null; responsible_wrike_ids: string[];
  description: string | null; permalink: string | null; due_date: string | null; completed_at: string | null;
  planned_minutes: number | null; allocated_minutes: number | null; raw_data: unknown;
  enriched_metadata: { folders?: ResolvedFolder[]; customFields?: ResolvedCustomField[]; customFieldsNormalized?: NormalizedCustomFieldValue[] } | null;
  wrike_time_entries: { id: string; entry_date: string; minutes: number; category: string | null; comment: string | null; user_wrike_id: string | null; wrike_users: { display_name: string; email: string | null } | null }[];
};

export default async function ProjectDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const returnTo = safeProjectsReturnTo(query.returnTo) ?? "/projects";
  const returnLabel = returnTo.startsWith("/development") ? "Development" : "Projects";
  const { supabase, profile } = await requireContext();
  const [{ data: project }, { data: users }, { data: categories }, { data: statuses }] = await Promise.all([
    supabase.from("wrike_tasks").select("*,wrike_time_entries(id,entry_date,minutes,category,comment,user_wrike_id,wrike_users(display_name,email))").eq("id", id).eq("organization_id", profile.organization_id).maybeSingle(),
    supabase.from("wrike_users").select("wrike_id,display_name,email,avatar_url,synced_at,is_active,is_unresolved,raw_data").eq("organization_id", profile.organization_id),
    supabase.from("wrike_timelog_categories").select("wrike_id,title,synced_at,is_unresolved").eq("organization_id", profile.organization_id),
    supabase.from("wrike_workflow_statuses").select("wrike_id,title,workflow_id,color,dashboard_classification,synced_at,is_unresolved").eq("organization_id", profile.organization_id)
  ]);
  if (!project) notFound();
  const row = project as unknown as ProjectDetailRow;
  const folders = row.enriched_metadata?.folders ?? [];
  const customFieldsRaw = row.enriched_metadata?.customFields ?? [];
  const customFields = row.enriched_metadata?.customFieldsNormalized ?? mergeNormalizedCustomFields(customFieldsRaw);
  const unresolvedCustomFields = customFieldsRaw.filter((field) => !field.resolved && !field.ignored);
  const assignees = resolveResponsibleUsers(row.responsible_wrike_ids ?? [], users ?? []);
  const statusReference = resolveTaskStatus(row.custom_status_id, row.status, statuses ?? []);

  return <AppShell isAdmin={profile.role === "admin"}>
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link href={returnTo}>{returnLabel}</Link><span aria-hidden="true">/</span><span aria-current="page">Project detail</span></nav>
    <header className="page-header"><div><p className="eyebrow">PROJECT DETAIL</p><h1>{row.title}</h1><p><StatusBadge name={statusReference.name} id={row.custom_status_id} color={statusReference.color} resolved={statusReference.resolved} /> · Due {row.due_date ?? "not set"}</p></div>{row.permalink && <a className="button" href={row.permalink} target="_blank" rel="noreferrer">Open in Wrike</a>}</header>
    <div className="admin-grid">
      <section className="card"><h2>Reporting details</h2><p><strong>Assignees:</strong> {assignees.length ? assignees.map((item, index) => <span key={item.wrikeUserId}>{index > 0 && ", "}{item.resolved ? item.fullName : <UnresolvedReferenceLabel id={item.wrikeUserId} type="user" />}</span>) : "Unassigned"}</p><p><strong>Planned effort:</strong> {row.planned_minutes == null ? "Not available" : `${hours(row.planned_minutes)} hours`}</p><p><strong>Allocated effort:</strong> {row.allocated_minutes == null ? "Not available" : `${hours(row.allocated_minutes)} hours`}</p><p><strong>Completion:</strong> {row.completed_at ? new Date(row.completed_at).toLocaleString() : "Not completed"}</p><p>{row.description || "No project description supplied by Wrike."}</p></section>
      <section className="card"><h2>Wrike folders</h2><TaskFolderList folders={folders} /></section>
      <section className="card"><h2>Wrike custom fields</h2><TaskCustomFieldList fields={customFields} unresolvedFields={unresolvedCustomFields} /></section>
    </div>
    {profile.role === "admin" && <section className="card"><h2>Administrator: original Wrike metadata</h2><p><strong>Responsible IDs:</strong> {(row.responsible_wrike_ids ?? []).join(", ") || "None"}<br /><strong>Custom status ID:</strong> {row.custom_status_id ?? "None"}</p><h3>Resolved and unresolved raw custom fields</h3><pre>{JSON.stringify(customFieldsRaw, null, 2)}</pre><h3>Original task response</h3><pre>{JSON.stringify(row.raw_data, null, 2)}</pre></section>}
    <section className="card"><h2>Visible time entries</h2>{row.wrike_time_entries.length ? <table><thead><tr><th>Date</th><th>Person</th><th>Category</th><th>Hours</th><th>Comment</th></tr></thead><tbody>{row.wrike_time_entries.map((entry) => {
      const person = entry.user_wrike_id ? resolveResponsibleUsers([entry.user_wrike_id], users ?? [])[0] : null;
      const category = resolveTimelogCategory(entry.category, categories ?? []);
      return <tr key={entry.id}><td>{entry.entry_date}</td><td>{person ? person.resolved ? person.fullName : <UnresolvedReferenceLabel id={person.wrikeUserId} type="user" /> : entry.wrike_users?.display_name ?? "Unknown"}</td><td>{category ? category.resolved ? category.name : <UnresolvedReferenceLabel id={category.wrikeCategoryId} type="timelog_category" /> : "—"}</td><td>{hours(entry.minutes)}</td><td>{entry.comment ?? "—"}</td></tr>;
    })}</tbody></table> : <p className="empty">No visible recorded time for this project.</p>}</section>
  </AppShell>;
}
