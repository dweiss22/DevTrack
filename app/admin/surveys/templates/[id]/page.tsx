import { notFound } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { SurveyDesigner } from "@/components/survey-designer";
import { requirePageCapability } from "@/lib/auth";
import { surveyDefinitionSchema } from "@/lib/surveys/definition";

export default async function SurveyTemplateDesignerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, supabase } = await requirePageCapability("manage_surveys");
  const [{ data: template }, { data: draft }] = await Promise.all([
    supabase.from("survey_templates").select("id,survey_type,archived_at").eq("id", id).eq("organization_id", profile.organization_id).maybeSingle(),
    supabase.from("survey_template_drafts").select("definition,lock_version").eq("template_id", id).eq("organization_id", profile.organization_id).maybeSingle(),
  ]);
  const definition = surveyDefinitionSchema.safeParse(draft?.definition);
  if (!template || template.archived_at || !draft || !definition.success) notFound();
  return <AppShell isAdmin>
    <header className="page-header"><div><p className="eyebrow">SURVEY DESIGNER</p>
      <h1>{definition.data.title}</h1><p>Draft changes do not affect users until a new immutable version is published.</p></div>
      <Link className="button secondary" href="/admin/surveys">Return to Surveys</Link></header>
    <SurveyDesigner templateId={template.id} initialDefinition={definition.data} initialLockVersion={draft.lock_version} />
  </AppShell>;
}
