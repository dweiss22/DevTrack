import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

type DeletionStatus = {
  id: string;
  targetUserId: string;
  stage: "requested" | "access_revoked" | "storage_cleaned" | "database_cleaned" | "auth_deleted" | "finalized" | "failed";
  resumeStage: DeletionStatus["stage"] | null;
};

export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const { supabase } = await requireCapability("delete_users");
  if (!z.string().uuid().safeParse(jobId).success) return NextResponse.json({ error: "Deletion unavailable." }, { status: 404 });
  const statusResult = await supabase.rpc("user_deletion_status", { target_deletion_id: jobId });
  const status = statusResult.data as DeletionStatus | null;
  if (statusResult.error || !status) return NextResponse.json({ error: "Deletion unavailable." }, { status: 404 });
  if (status.stage === "finalized") return NextResponse.json({ deletion: status });
  const stage = status.stage === "failed" ? status.resumeStage : status.stage;
  if (!stage) return NextResponse.json({ error: "Deletion cannot be resumed." }, { status: 409 });
  const admin = createAdminClient();
  try {
    if (stage === "requested") {
      const { error } = await admin.auth.admin.updateUserById(status.targetUserId, { ban_duration: "876000h" });
      if (error && error.status !== 404) throw error;
      return stageResult(supabase, jobId, "requested", "access_revoked");
    }
    if (stage === "access_revoked") {
      const objectsResult = await supabase.rpc("user_deletion_storage_objects", { target_deletion_id: jobId });
      if (objectsResult.error) throw objectsResult.error;
      const keys = ((objectsResult.data ?? []) as Array<{ object_key: string }>).map((item) => item.object_key);
      if (keys.length) {
        const { error } = await admin.storage.from("survey-invoices").remove(keys);
        if (error) throw error;
      }
      return stageResult(supabase, jobId, "access_revoked", "storage_cleaned");
    }
    if (stage === "storage_cleaned") {
      const { data, error } = await supabase.rpc("cleanup_user_deletion_database", { target_deletion_id: jobId });
      if (error || !data) throw error ?? new Error("Database cleanup failed.");
      return NextResponse.json({ deletion: data });
    }
    if (stage === "database_cleaned") {
      const { error } = await admin.auth.admin.deleteUser(status.targetUserId);
      if (error && error.status !== 404) throw error;
      return stageResult(supabase, jobId, "database_cleaned", "auth_deleted");
    }
    return stageResult(supabase, jobId, "auth_deleted", "finalized");
  } catch (error) {
    const message = error instanceof Error ? error.message : "The deletion stage failed.";
    const failure = await supabase.rpc("mark_user_deletion_stage", {
      target_deletion_id: jobId,
      expected_stage: stage,
      next_stage: stage,
      failure_message: message,
    });
    return NextResponse.json({ error: "The deletion is incomplete and can be retried.", deletion: failure.data }, { status: 500 });
  }
}

async function stageResult(
  supabase: Awaited<ReturnType<typeof requireCapability>>["supabase"],
  id: string,
  expected: string,
  next: string,
) {
  const { data, error } = await supabase.rpc("mark_user_deletion_stage", {
    target_deletion_id: id,
    expected_stage: expected,
    next_stage: next,
    failure_message: null,
  });
  if (error || !data) throw error ?? new Error("Deletion progress could not be saved.");
  return NextResponse.json({ deletion: data });
}
