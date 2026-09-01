import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SmeProjectDetailData } from "@/components/sme-project-detail";

export type SmeProjectAccessState =
  | "not_found"
  | "selection_required"
  | "mapping_missing"
  | "identity_unavailable"
  | "not_assigned"
  | "assignment_conflict"
  | "unavailable";

export type SmeProjectLoadResult =
  | { ok: true; detail: SmeProjectDetailData }
  | { ok: false; state: SmeProjectAccessState };

export async function loadSmeProjectDetail({
  supabase,
  projectId,
  requestedSme,
  canSelect,
}: {
  supabase: SupabaseClient;
  projectId: string;
  requestedSme?: string;
  canSelect: boolean;
}): Promise<SmeProjectLoadResult | null> {
  if (!z.string().uuid().safeParse(projectId).success) return null;
  if (canSelect && requestedSme && !z.string().uuid().safeParse(requestedSme).success) {
    return { ok: false, state: "identity_unavailable" };
  }
  const selectedSme = canSelect
    ? z.string().uuid().safeParse(requestedSme).success ? requestedSme : null
    : null;
  const { data, error } = await supabase.rpc("sme_project_detail_by_identity", {
    target_task_id: projectId,
    target_sme_identity_id: selectedSme,
  });
  if (error) {
    console.error("sme_project_detail_failed", {
      projectId,
      selectedSme: canSelect ? selectedSme : null,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    throw new Error(`SME project detail failed (${error.code ?? "database_error"}).`);
  }
  if (!data || typeof data !== "object") return { ok: false, state: "unavailable" };
  const state = (data as { state?: string }).state;
  if (state !== "allowed") {
    const known: SmeProjectAccessState[] = [
      "not_found", "selection_required", "mapping_missing", "identity_unavailable",
      "not_assigned", "assignment_conflict", "unavailable",
    ];
    return { ok: false, state: known.includes(state as SmeProjectAccessState)
      ? state as SmeProjectAccessState : "unavailable" };
  }
  return { ok: true, detail: data as SmeProjectDetailData };
}
