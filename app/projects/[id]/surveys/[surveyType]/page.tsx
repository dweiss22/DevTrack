import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SurveyDialog } from "@/components/survey-dialog";
import { requirePageCapability } from "@/lib/auth";
import { isAdministratorRole } from "@/lib/auth/roles";
import { surveyTitle } from "@/lib/surveys/domain";
import { surveyTypeFromSlug } from "@/lib/surveys/server";

export default async function DirectSurvey({ params }: { params: Promise<{ id: string; surveyType: string }> }) {
  const { id, surveyType: slug } = await params;
  const surveyType = surveyTypeFromSlug(slug);
  if (!surveyType) notFound();
  const { profile, supabase } = await requirePageCapability("view_surveys");
  const { data: context, error } = await supabase.rpc("survey_context_for_task", { target_task_id: id, requested_type: surveyType });
  if (error || !context) notFound();
  return <>
    <AppShell isAdmin={isAdministratorRole(profile.role)}>
      <header className="page-header"><div><p className="eyebrow">PROJECT SURVEY</p><h1>{context.taskTitle}</h1><p>{surveyTitle(surveyType)} for this trusted synchronized project.</p></div></header>
      <section className="card"><h2>Project context</h2><p><strong>Status:</strong> {context.status}<br /><strong>Wrike task:</strong> {context.taskWrikeId}<br /><strong>Reporting year:</strong> {context.reportingYear ?? "Unavailable"}</p></section>
    </AppShell>
    <SurveyDialog taskId={id} surveyType={surveyType} fallbackHref={profile.role === "sme" ? "/sme-dashboard" : `/projects/${id}`} />
  </>;
}
