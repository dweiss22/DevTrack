import { notFound } from "next/navigation";
import { SurveyDialog } from "@/components/survey-dialog";
import { requirePageCapability } from "@/lib/auth";
import { surveyTypeFromSlug } from "@/lib/surveys/server";
import { dashboardReturnHref } from "@/lib/dashboards/domain";

export default async function InterceptedSurvey({ params, searchParams }: { params: Promise<{ id: string; surveyType: string }>; searchParams: Promise<{ sme?: string; returnTo?: string }> }) {
  await requirePageCapability("view_surveys");
  const { id, surveyType: slug } = await params;
  const surveyType = surveyTypeFromSlug(slug);
  if (!surveyType) notFound();
  const query = await searchParams;
  return <SurveyDialog taskId={id} surveyType={surveyType} initialSmeWrikeId={query.sme}
    fallbackHref={dashboardReturnHref(query.returnTo, "/surveys")} />;
}
