import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const scopeSchema = z.object({ label: z.string().trim().min(2).max(120), scopeType: z.enum(["account", "space", "folder", "project", "task", "list"]), sourceIds: z.array(z.string().trim().min(1)).min(1).max(50), reportingUserIds: z.array(z.string()).max(500).default([]) });
export async function POST(request: NextRequest) {
  const { user, profile } = await requireAdmin();
  const parsed = scopeSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid scope configuration." }, { status: 400 });
  const { label, scopeType, sourceIds, reportingUserIds } = parsed.data;
  const { data, error } = await createAdminClient().from("wrike_sync_scopes").insert({ organization_id: profile.organization_id, label, scope_type: scopeType, source_ids: sourceIds, reporting_user_ids: reportingUserIds, created_by: user.id }).select("id").single();
  if (error) return NextResponse.json({ error: "Unable to save the scope." }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
