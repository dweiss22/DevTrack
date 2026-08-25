import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { FolderImportError, importConfiguredFolderTasks, WrikeMigrationRequiredError } from "@/lib/wrike/folder-task-import";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return new NextResponse("Unauthorized", { status: 401 });

  const db = createAdminClient();
  const { data: connections, error } = await db.from("wrike_connections").select("organization_id").eq("status", "connected");
  if (error) return NextResponse.json({ error: "Unable to load connected Wrike organizations." }, { status: 500 });

  const results = [];
  for (const { organization_id: organizationId } of connections ?? []) {
    try {
      const result = await importConfiguredFolderTasks(organizationId, { triggerSource: "scheduled" });
      results.push({ organizationId, ok: true, ...result });
    } catch (importError) {
      results.push({
        organizationId,
        ok: false,
        error: importError instanceof Error ? importError.message : "Folder task and timelog import failed.",
        folderFailures: importError instanceof FolderImportError ? importError.folderFailures : [],
        migration: importError instanceof WrikeMigrationRequiredError ? importError.migration : undefined
      });
    }
  }

  return NextResponse.json({ organizationCount: results.length, results });
}
