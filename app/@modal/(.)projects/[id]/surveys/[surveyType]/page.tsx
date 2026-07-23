import { notFound } from "next/navigation";
import { SurveyDialog } from "@/components/survey-dialog";
import { requirePageCapability } from "@/lib/auth";
import { surveyTypeFromSlug } from "@/lib/surveys/server";

export default async function InterceptedSurvey({ params }: { params: Promise<{ id: string; surveyType: string }> }) {
  await requirePageCapability("view_surveys");
  const { id, surveyType: slug } = await params;
  const surveyType = surveyTypeFromSlug(slug);
  if (!surveyType) notFound();
  return <SurveyDialog taskId={id} surveyType={surveyType} fallbackHref="/surveys" />;
}
