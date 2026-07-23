export type DashboardIdentity = {
  identity_key: string;
  wrike_user_id: string | null;
  application_user_id: string | null;
  display_name: string;
  email: string | null;
  mapping_status: "mapped" | "unmapped" | "missing";
  identity_status: "verified" | "ambiguous" | "unverified";
  selectable: boolean;
};

export type SurveySummary = {
  id: string;
  status: "draft" | "submitted";
  isLocked: boolean;
  canEdit?: boolean;
  revisionNumber: number;
  creatorName?: string;
};

export function surveyActionLabel(summary: SurveySummary | null | undefined, noun: "survey" | "review") {
  if (!summary) return noun === "survey" ? "Start survey" : "Start review";
  if (summary.status === "draft") return noun === "survey" ? "Resume survey" : "Resume review";
  if (!summary.isLocked && summary.canEdit) return noun === "survey" ? "Revise survey" : "Revise review";
  return noun === "survey" ? "View submitted survey" : "View submitted review";
}

export function colleagueReviewLabel(summary: SurveySummary) {
  const creator = summary.creatorName || "Colleague";
  return summary.status === "draft"
    ? `View ${creator}’s draft`
    : `View ${creator}’s submitted review`;
}

export function dashboardReturnHref(value: string | string[] | undefined, fallback: string) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate?.startsWith("/") || candidate.startsWith("//")) return fallback;
  const allowed = candidate === "/sme-dashboard" || candidate.startsWith("/sme-dashboard?")
    || /^\/sme-dashboard\/projects\/[0-9a-f-]+$/i.test(candidate)
    || candidate === "/id-dashboard" || candidate.startsWith("/id-dashboard?")
    || candidate === "/surveys" || candidate.startsWith("/surveys?")
    || /^\/projects\/[0-9a-f-]+(?:\?.*)?$/i.test(candidate);
  return allowed ? candidate : fallback;
}

export function surveyHref(taskId: string, type: "course-development-debrief" | "id-sme-review", wrikeUserId: string | null, returnTo: string) {
  const query = new URLSearchParams({ returnTo });
  if (wrikeUserId) query.set("sme", wrikeUserId);
  return `/projects/${taskId}/surveys/${type}?${query}`;
}

export function submissionHref(submissionId: string, returnTo: string, readOnly = false) {
  const query = new URLSearchParams({ returnTo });
  if (readOnly) query.set("readOnly", "1");
  return `/surveys/${submissionId}?${query}`;
}
