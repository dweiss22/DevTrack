import { AppShell } from "@/components/app-shell";
import { SurveyDialog } from "@/components/survey-dialog";
import { requirePageCapability } from "@/lib/auth";
import { isAdministratorRole } from "@/lib/auth/roles";
import { dashboardReturnHref } from "@/lib/dashboards/domain";

export default async function SurveyDetailPage({ params, searchParams }: { params: Promise<{ submissionId: string }>; searchParams: Promise<{ returnTo?: string; readOnly?: string }> }) {
  const { submissionId } = await params;
  const { profile } = await requirePageCapability("view_surveys");
  const query = await searchParams;
  return <>
    <AppShell isAdmin={isAdministratorRole(profile.role)}>
      <header className="page-header"><div><p className="eyebrow">SURVEY RESPONSE</p><h1>Survey detail</h1><p>Authorized response, attachment, and revision access.</p></div></header>
      <section className="card"><p>The survey response is open in a secure dialog.</p></section>
    </AppShell>
    <SurveyDialog submissionId={submissionId} fallbackHref={dashboardReturnHref(query.returnTo, "/surveys")}
      forceReadOnly={profile.role === "id" && query.readOnly === "1"} />
  </>;
}
