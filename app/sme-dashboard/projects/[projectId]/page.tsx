import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SmeProjectDetail, type SmeProjectDetailData } from "@/components/sme-project-detail";
import { SmeProjectAccessState } from "@/components/sme-project-access-state";
import { requirePageCapability } from "@/lib/auth";
import { hasCapability } from "@/lib/auth/roles";
import { loadSmeProjectDetail } from "@/lib/smes/project-detail";

export default async function SmeProjectPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ sme?: string; scope?: string }>;
}) {
  const { projectId } = await params; const query = await searchParams;
  const { supabase, profile, user } = await requirePageCapability("view_sme_dashboard");
  const canSelect = profile.access.managementRoles.some((role) =>
    role === "sme_coordinator" || role === "admin" || role === "super_admin");
  const result = await loadSmeProjectDetail({
    supabase, projectId, requestedSme: query.sme, canSelect,
  });
  if (!result) notFound();
  if (!result.ok && result.state === "not_found") notFound();
  const scope = query.scope === "all" ? "all" : "recent";
  const fallback = `/sme-dashboard?scope=${scope}`;
  if (!result.ok) return <AppShell><SmeProjectAccessState state={result.state} returnTo={fallback} /></AppShell>;
  const detail = result.detail;
  const returnTo = `/sme-dashboard?sme=${encodeURIComponent(detail.selectedSmeWrikeUserId)}&scope=${scope}`;
  return <AppShell><nav className="breadcrumb" aria-label="Breadcrumb"><Link href={returnTo}>SME Dashboard</Link>
    <span aria-hidden="true">/</span><span aria-current="page">Course detail</span></nav>
    <SmeProjectDetail detail={detail} returnTo={returnTo}
      canLaunchSurvey={detail.subjectApplicationUserId === user.id}
      managementView={hasCapability(profile.access, "view_sme_survey_details")} /></AppShell>;
}
