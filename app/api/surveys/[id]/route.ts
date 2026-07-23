import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { surveySaveSchema } from "@/lib/surveys/domain";
import { loadSurveyDetail, surveyDetailForSme } from "@/lib/surveys/server";

const idSchema = z.string().uuid();

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, supabase } = await requireCapability("view_surveys");
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Survey is unavailable." }, { status: 404 });
  const detail = await loadSurveyDetail(supabase, id);
  if (!detail) return NextResponse.json({ error: "Survey is unavailable." }, { status: 404 });
  const { data: canEdit } = await supabase.rpc("can_edit_survey", { target_submission_id: id });
  if (profile.role !== "super_admin" && profile.role !== "admin") {
    const visibleDetail = profile.role === "sme" ? surveyDetailForSme(detail) : detail;
    return NextResponse.json({ ...visibleDetail, viewer: { role: profile.role, canEdit: Boolean(canEdit), canManage: false } });
  }
  const [audit, revisions, revisers, actors] = await Promise.all([
    supabase.from("survey_audit_log").select("id,event_type,actor_id,actor_role,reason,previous_values,new_values,created_at").eq("submission_id", id).order("created_at", { ascending: false }),
    supabase.from("survey_revisions").select("id,revision_number,changed_fields,submitted_by,submitted_at").eq("submission_id", id).order("revision_number", { ascending: false }),
    supabase.from("application_users").select("id,display_name").eq("organization_id", profile.organization_id).eq("role", "id").order("display_name"),
    supabase.from("application_users").select("id,display_name").eq("organization_id", profile.organization_id),
  ]);
  const actorNames = Object.fromEntries((actors.data ?? []).map((actor) => [actor.id, actor.display_name ?? "Unnamed user"]));
  return NextResponse.json({
    ...detail,
    viewer: { role: profile.role, canEdit: Boolean(canEdit), canManage: true },
    audit: (audit.data ?? []).map((event) => ({ ...event, actor_name: actorNames[event.actor_id] ?? "Unavailable" })),
    revisions: (revisions.data ?? []).map((revision) => ({ ...revision, submitted_by_name: actorNames[revision.submitted_by] ?? "Unavailable" })),
    revisers: revisers.data ?? [],
    actors: actorNames,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireCapability("view_surveys");
  const parsed = surveySaveSchema.safeParse(await request.json().catch(() => null));
  if (!idSchema.safeParse(id).success || !parsed.success) {
    const fieldErrors = parsed.success ? undefined : parsed.error.flatten().fieldErrors;
    return NextResponse.json({ error: "Review the highlighted survey fields.", fieldErrors }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("survey_save", {
    target_submission_id: id,
    answers: parsed.data.answers,
    submit_now: parsed.data.submit,
  });
  return error
    ? NextResponse.json({ error: error.message || "The survey could not be saved." }, { status: error.code === "42501" ? 403 : 400 })
    : NextResponse.json(data);
}
