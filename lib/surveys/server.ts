import type { SupabaseClient } from "@supabase/supabase-js";
import type { SurveyType } from "@/lib/surveys/domain";

export async function loadSurveyDetail(supabase: SupabaseClient, id: string) {
  const submissionResult = await supabase.from("survey_submissions").select(
    "id,survey_type,task_id,project_id,subject_application_user_id,reviewed_wrike_user_id,created_by,revision_assignee_id,context_snapshot,status,is_locked,revision_number,original_submitted_at,latest_submitted_at,unlock_reason,created_at,updated_at"
  ).eq("id", id).maybeSingle();
  if (submissionResult.error || !submissionResult.data) return null;
  const submission = submissionResult.data;
  const responseTable = submission.survey_type === "course_development_debrief"
    ? "course_development_debrief_responses" : "id_sme_review_responses";
  const [responseResult, attachmentResult] = await Promise.all([
    supabase.from(responseTable).select("*").eq("submission_id", id).maybeSingle(),
    supabase.from("survey_attachments").select("id,revision_number,original_filename,mime_type,size_bytes,uploaded_at,is_active")
      .eq("submission_id", id).eq("is_active", true).order("uploaded_at", { ascending: false }),
  ]);
  if (responseResult.error || attachmentResult.error) return null;
  return { submission, response: responseResult.data, attachments: attachmentResult.data ?? [] };
}

export function surveyTypeFromSlug(value: string): SurveyType | null {
  if (value === "course-development-debrief") return "course_development_debrief";
  if (value === "id-sme-review") return "id_sme_review";
  return null;
}

export function surveySlug(type: SurveyType) {
  return type === "course_development_debrief" ? "course-development-debrief" : "id-sme-review";
}
