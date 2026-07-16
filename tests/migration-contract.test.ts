import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607160002_reliable_reporting.sql"), "utf8");
const spaceImportMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607160003_one_click_space_import.sql"), "utf8");
const folderImportMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607160004_folder_task_import.sql"), "utf8");
describe("reporting migration contract", () => {
  it("includes source/person access modes and scoped task/time policies", () => {
    expect(migration).toContain("reporting_match_mode as enum ('intersection', 'union')");
    expect(migration).toContain("can_access_wrike_task");
    expect(migration).toContain("can_access_wrike_time_entry");
    expect(migration).toContain("scoped task read");
    expect(migration).toContain("scoped entry read");
  });
  it("includes saved-history RLS and 90-day cleanup support", () => {
    expect(migration).toContain("conversation owner or admin read");
    expect(migration).toContain("cleanup_reporting_messages");
    expect(migration).toContain("reporting_messages_retention_idx");
    expect(migration).toContain("grant execute on function public.cleanup_reporting_messages(integer) to service_role");
    expect(migration).toContain("lease_token = target_token");
  });
  it("keeps the legacy Space migration valid before the focused follow-up migration", () => {
    expect(spaceImportMigration).toContain("wrike_import_space_id");
    expect(spaceImportMigration).toContain("view public.wrike_space_report");
    expect(spaceImportMigration).toContain("security_invoker = true");
    expect(spaceImportMigration).toContain("table public.wrike_space_report_rows");
    expect(spaceImportMigration).toContain("refresh_wrike_space_report_rows");
  });
  it("provides a focused folder-task import and organization-scoped reset", () => {
    expect(folderImportMigration).toContain("table public.wrike_folder_task_imports");
    expect(folderImportMigration).toContain("table public.wrike_folder_task_import_runs");
    expect(folderImportMigration).toContain("reset_wrike_reporting_data");
    expect(folderImportMigration).toContain("delete from public.wrike_tasks where organization_id=target_organization_id");
    expect(folderImportMigration).toContain("grant execute on function public.reset_wrike_reporting_data(uuid) to service_role");
  });
});
