import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncOrganization } from "@/lib/wrike/sync";

const requestSchema = z.object({ spaceId: z.string().trim().regex(/^[A-Za-z0-9]+$/).min(5).max(100) });
const IMPORT_SCOPE_LABEL = "One-click Wrike Space import";

export async function POST(request: NextRequest) {
  const { user, profile } = await requireAdmin();
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid Wrike Space ID." }, { status: 400 });
  const spaceId = parsed.data.spaceId;
  const db = createAdminClient();
  const { error: organizationError } = await db.from("organizations").update({ wrike_import_space_id: spaceId, updated_at: new Date().toISOString() }).eq("id", profile.organization_id);
  if (organizationError) return NextResponse.json({ error: "Apply migration 202607160003 before importing a Wrike Space." }, { status: 500 });

  const { error: deactivateError } = await db.from("wrike_sync_scopes").update({ is_active: false, updated_at: new Date().toISOString() }).eq("organization_id", profile.organization_id).neq("label", IMPORT_SCOPE_LABEL);
  if (deactivateError) return NextResponse.json({ error: "Unable to limit synchronization to the selected Wrike Space." }, { status: 500 });

  const { data: existing, error: scopeReadError } = await db.from("wrike_sync_scopes").select("id").eq("organization_id", profile.organization_id).eq("label", IMPORT_SCOPE_LABEL).limit(1).maybeSingle();
  if (scopeReadError) return NextResponse.json({ error: "Unable to read the configured Wrike import scope." }, { status: 500 });
  let scopeId = existing?.id;
  if (scopeId) {
    const { error } = await db.from("wrike_sync_scopes").update({ scope_type: "space", source_ids: [spaceId], is_active: true, updated_at: new Date().toISOString() }).eq("id", scopeId);
    if (error) return NextResponse.json({ error: "Unable to update the Wrike import scope." }, { status: 500 });
  } else {
    const { data, error } = await db.from("wrike_sync_scopes").insert({ organization_id: profile.organization_id, scope_type: "space", source_ids: [spaceId], label: IMPORT_SCOPE_LABEL, reporting_user_ids: [], is_active: true, created_by: user.id }).select("id").single();
    if (error || !data) return NextResponse.json({ error: "Unable to create the Wrike import scope." }, { status: 500 });
    scopeId = data.id;
  }

  try {
    const result = await syncOrganization(profile.organization_id, { scopeIds: [scopeId], mode: "full", trigger: "manual" });
    const { data: snapshotRows, error: snapshotError } = await db.rpc("refresh_wrike_space_report_rows", { target_organization_id: profile.organization_id });
    if (snapshotError) return NextResponse.json({ error: "Wrike data was synchronized, but the single-table reporting snapshot could not be refreshed. Confirm migration 202607160003 is applied." }, { status: 500 });
    return NextResponse.json({ ok: true, spaceId, scopeId, snapshotRows: snapshotRows ?? 0, ...result, reportUrl: "/tasks", timeUrl: "/time-entries" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Wrike Space import failed." }, { status: 500 });
  }
}
