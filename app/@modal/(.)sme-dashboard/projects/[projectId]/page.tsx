import { notFound } from "next/navigation";
import { SmeProjectDetail, type SmeProjectDetailData } from "@/components/sme-project-detail";
import { SmeProjectModal } from "@/components/sme-project-modal";
import { requirePageCapability } from "@/lib/auth";
import { hasCapability } from "@/lib/auth/roles";

export default async function SmeProjectInterceptedModal({ params, searchParams }: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ sme?: string; scope?: string }>;
}) {
  const { projectId } = await params; const query = await searchParams;
  const { supabase, profile, user } = await requirePageCapability("view_sme_dashboard");
  const { data, error } = await supabase.rpc("sme_project_detail", {
    target_task_id: projectId, target_sme_wrike_user_id: query.sme ?? null,
  });
  if (error || !data) notFound();
  const detail = data as SmeProjectDetailData;
  const scope = query.scope === "all" ? "all" : "recent";
  const returnTo = `/sme-dashboard?sme=${encodeURIComponent(detail.selectedSmeWrikeUserId)}&scope=${scope}`;
  return <SmeProjectModal><SmeProjectDetail detail={detail} returnTo={returnTo}
    canLaunchSurvey={detail.subjectApplicationUserId === user.id}
    managementView={hasCapability(profile.access, "view_sme_survey_details")} /></SmeProjectModal>;
}
