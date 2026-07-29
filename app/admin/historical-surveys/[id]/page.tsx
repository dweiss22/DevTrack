import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { HistoricalSurveyProjectMatch } from "@/components/historical-survey-project-match";
import { requirePageCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function HistoricalSurveyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile } = await requirePageCapability("manage_data");
  const admin = createAdminClient();
  const { data: response } = await admin.from("historical_survey_responses").select("*")
    .eq("id", id).eq("organization_id", profile.organization_id).maybeSingle();
  if (!response) notFound();
  const [detailResult, auditResult, projectResult] = await Promise.all([
    response.survey_type === "SME_DEBRIEF"
      ? admin.from("historical_sme_debrief_responses").select("*").eq("response_id", id).maybeSingle()
      : admin.from("historical_id_sme_review_responses").select("*").eq("response_id", id).maybeSingle(),
    admin.from("historical_survey_response_audit").select("id,action,previous_values,new_values,created_at")
      .eq("response_id", id).eq("organization_id", profile.organization_id).order("created_at", { ascending: false }),
    admin.from("wrike_tasks").select("id,title,wrike_id").eq("organization_id", profile.organization_id)
      .eq("is_deleted", false).order("title").limit(10_000),
  ]);
  return <AppShell isAdmin>
    <header className="page-header"><div><p className="eyebrow">HISTORICAL SURVEY RESPONSE</p>
      <h1>{response.historical_course_name}</h1>
      <p>{response.survey_type} · {response.survey_version} · {response.original_source_response_id}</p></div>
      <Link className="button secondary" href={`/admin/survey-imports?batch=${response.import_batch_id}`}>View import batch</Link></header>
    <div className="admin-stack">
      <section className="card"><h2>Submitted context</h2><dl className="summary-grid">
        <div><dt>Submitted</dt><dd>{new Date(response.submitted_at).toLocaleString()}</dd></div>
        <div><dt>Import source</dt><dd>{response.import_source}</dd></div>
        <div><dt>Respondent</dt><dd>{response.respondent_name || "Unmatched"}<br />{response.respondent_email}</dd></div>
        <div><dt>Reviewed SME</dt><dd>{response.reviewed_sme_name || "Unmatched"}<br />{response.reviewed_sme_email}</dd></div>
        <div><dt>Original course</dt><dd>{response.historical_course_name}</dd></div>
        <div><dt>Match state</dt><dd>{response.matched_task_id ? `${response.match_method} (${response.match_confidence})` : "Unmatched"}</dd></div>
      </dl></section>
      <section className="card"><h2>Project association</h2>
        <HistoricalSurveyProjectMatch responseId={response.id} currentTaskId={response.matched_task_id}
          projects={(projectResult.data ?? []).map((project) => ({ id: project.id, title: project.title, wrikeId: project.wrike_id }))} />
      </section>
      <section className="card"><h2>Normalized response</h2><pre>{JSON.stringify(detailResult.data, null, 2)}</pre></section>
      <section className="card"><h2>Audit history</h2>{auditResult.data?.length
        ? <ul className="detail-list">{auditResult.data.map((event) => <li key={event.id}>
          <strong>{event.action.replaceAll("_", " ")}</strong> · {new Date(event.created_at).toLocaleString()}
        </li>)}</ul> : <p className="empty">No audit events are available.</p>}</section>
    </div>
  </AppShell>;
}
