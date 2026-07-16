import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(2).max(100), description: z.string().trim().max(500).optional(), matchMode: z.enum(["intersection", "union"]), memberIds: z.array(z.string().uuid()).max(500).default([]), scopeIds: z.array(z.string().uuid()).max(100).default([]), wrikeUserIds: z.array(z.string().uuid()).max(1000).default([]) }).refine((value) => value.scopeIds.length > 0 || value.wrikeUserIds.length > 0, "At least one source or person restriction is required.");

export async function POST(request: NextRequest) {
  const { user, profile } = await requireAdmin(); const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid reporting group." }, { status: 400 });
  const db = createAdminClient(); const value = parsed.data;
  const [{ data: members }, { data: scopes }, { data: wrikeUsers }] = await Promise.all([
    value.memberIds.length ? db.from("application_users").select("id").eq("organization_id", profile.organization_id).in("id", value.memberIds) : { data: [] },
    value.scopeIds.length ? db.from("wrike_sync_scopes").select("id").eq("organization_id", profile.organization_id).in("id", value.scopeIds) : { data: [] },
    value.wrikeUserIds.length ? db.from("wrike_users").select("id").eq("organization_id", profile.organization_id).in("id", value.wrikeUserIds) : { data: [] }
  ]);
  if ((members ?? []).length !== value.memberIds.length || (scopes ?? []).length !== value.scopeIds.length || (wrikeUsers ?? []).length !== value.wrikeUserIds.length) return NextResponse.json({ error: "One or more selected records are outside this organization." }, { status: 400 });
  const groupValues = { organization_id: profile.organization_id, name: value.name, description: value.description ?? null, match_mode: value.matchMode, created_by: user.id, updated_at: new Date().toISOString() };
  const result = value.id ? await db.from("reporting_groups").update(groupValues).eq("id", value.id).eq("organization_id", profile.organization_id).select("id").single() : await db.from("reporting_groups").insert(groupValues).select("id").single();
  if (result.error || !result.data) return NextResponse.json({ error: "Unable to save the reporting group." }, { status: 500 });
  const groupId = result.data.id;
  await Promise.all([db.from("reporting_group_members").delete().eq("group_id", groupId), db.from("reporting_group_scopes").delete().eq("group_id", groupId), db.from("reporting_group_wrike_users").delete().eq("group_id", groupId)]);
  const inserts = [];
  if (value.memberIds.length) inserts.push(db.from("reporting_group_members").insert(value.memberIds.map((application_user_id) => ({ group_id: groupId, application_user_id }))));
  if (value.scopeIds.length) inserts.push(db.from("reporting_group_scopes").insert(value.scopeIds.map((scope_id) => ({ group_id: groupId, scope_id }))));
  if (value.wrikeUserIds.length) inserts.push(db.from("reporting_group_wrike_users").insert(value.wrikeUserIds.map((wrike_user_id) => ({ group_id: groupId, wrike_user_id }))));
  const inserted = await Promise.all(inserts); const associationError = inserted.find((item) => item.error)?.error;
  if (associationError) return NextResponse.json({ error: "The group was saved, but its assignments could not be completed." }, { status: 500 });
  return NextResponse.json({ id: groupId });
}
