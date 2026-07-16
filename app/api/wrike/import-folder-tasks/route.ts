import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { importConfiguredFolderTasks } from "@/lib/wrike/folder-task-import";

export async function POST() {
  const { profile } = await requireAdmin();
  try {
    const result = await importConfiguredFolderTasks(profile.organization_id);
    return NextResponse.json({ ok: true, ...result, tasksUrl: "/tasks" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Folder task import failed." }, { status: 500 });
  }
}
