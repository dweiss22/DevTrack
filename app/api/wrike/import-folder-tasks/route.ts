import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { FolderImportError, importConfiguredFolderTasks, WrikeMigrationRequiredError } from "@/lib/wrike/folder-task-import";

export async function POST() {
  const { profile } = await requireAdmin();
  try {
    const result = await importConfiguredFolderTasks(profile.organization_id);
    return NextResponse.json({ ok: true, ...result, tasksUrl: "/projects" });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Folder task and timelog import failed.",
      folderFailures: error instanceof FolderImportError ? error.folderFailures : [],
      migration: error instanceof WrikeMigrationRequiredError ? error.migration : undefined
    }, { status: error instanceof WrikeMigrationRequiredError ? 503 : 500 });
  }
}
