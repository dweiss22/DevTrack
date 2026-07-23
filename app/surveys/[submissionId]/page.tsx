import { AppShell } from "@/components/app-shell";
import { SurveyDialog } from "@/components/survey-dialog";
import { requirePageCapability } from "@/lib/auth";
import { isAdministratorRole } from "@/lib/auth/roles";

export default async function SurveyDetailPage({ params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params;
  const { profile } = await requirePageCapability("view_surveys");
  return <>
    <AppShell isAdmin={isAdministratorRole(profile.role)}>
      <header className="page-header"><div><p className="eyebrow">SURVEY RESPONSE</p><h1>Survey detail</h1><p>Authorized response, attachment, and revision access.</p></div></header>
      <section className="card"><p>The survey response is open in a secure dialog.</p></section>
    </AppShell>
    <SurveyDialog submissionId={submissionId} fallbackHref="/surveys" />
  </>;
}
