import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { SurveyDialog } from "@/components/survey-dialog";
import { requirePageCapability } from "@/lib/auth";

export default async function AdminSurveySubmissionPage({ params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params;
  await requirePageCapability("manage_surveys");
  return <>
    <AppShell isAdmin>
      <header className="page-header"><div><p className="eyebrow">SURVEY SUBMISSION</p><h1>Submission detail</h1>
        <p>Authorized response, version, attachment, revision, and audit access.</p></div>
        <Link className="button secondary" href="/admin/surveys?view=submissions">Return to Surveys</Link></header>
    </AppShell>
    <SurveyDialog submissionId={submissionId} fallbackHref="/admin/surveys?view=submissions"
      apiBase="/api/admin/surveys/submissions" />
  </>;
}
