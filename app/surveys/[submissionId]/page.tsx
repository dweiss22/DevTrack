import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SurveyDialog } from "@/components/survey-dialog";
import { requirePageCapability } from "@/lib/auth";
import { isAdministratorRole, landingPageForRole } from "@/lib/auth/roles";
import { dashboardReturnHref } from "@/lib/dashboards/domain";

export default async function SurveyDetailPage({ params, searchParams }: { params: Promise<{ submissionId: string }>; searchParams: Promise<{ returnTo?: string; readOnly?: string }> }) {
  const { submissionId } = await params;
  const { profile, supabase } = await requirePageCapability("view_personal_surveys");
  const query = await searchParams;
  const { data: canView } = await supabase.rpc("can_view_survey", {
    target_submission_id: submissionId,
  });
  if (!canView) notFound();
  return <>
    <AppShell isAdmin={isAdministratorRole(profile.role)}>
      <header className="page-header"><div><p className="eyebrow">SURVEY RESPONSE</p><h1>Survey detail</h1><p>Authorized response, attachment, and revision access.</p></div></header>
      <section className="card"><p>The survey response is open in a secure dialog.</p></section>
    </AppShell>
    <SurveyDialog submissionId={submissionId} fallbackHref={dashboardReturnHref(query.returnTo, landingPageForRole(profile.access))}
      forceReadOnly={query.readOnly === "1"} />
  </>;
}
