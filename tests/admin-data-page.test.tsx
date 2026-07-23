import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const panel = fs.readFileSync(path.join(root, "components/admin-panel.tsx"), "utf8");
const page = fs.readFileSync(path.join(root, "app/admin/page.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
const historyRoute = fs.readFileSync(path.join(root, "app/api/admin/wrike/history/route.ts"), "utf8");
const historyMigration = fs.readFileSync(path.join(root, "supabase/migrations/202607230001_clear_wrike_run_history.sql"), "utf8");

describe("Data page organization", () => {
  it("uses collapsible sections throughout the administration workspace", () => {
    expect(panel.match(/<AdminDisclosure /g)?.length).toBeGreaterThanOrEqual(4);
    expect(panel).toContain('<details className="card admin-disclosure"');
    expect(css).toContain(".admin-disclosure[open] > summary::after");
  });

  it("combines import and repair actions in one focused section", () => {
    const workspace = panel.slice(panel.indexOf('title="Import & repair"'), panel.indexOf('title="Connection & source folders"'));
    expect(workspace).toContain("importFolderTasks");
    expect(workspace).toContain("repairVerticals");
    expect(workspace).toContain('href="#data-history"');
  });

  it("offers a clear combined history view", () => {
    expect(panel).toContain('title="History"');
    expect(panel).toContain('id="data-history"');
    expect(panel).toContain("Combined import history");
    expect(panel).toContain("Vertical repair history");
    expect(panel).toContain("Clear history");
    expect(panel).toContain('fetch("/api/admin/wrike/history", { method: "DELETE" })');
    expect(panel).toContain("This cannot be undone.");
    expect(panel).not.toContain("Refresh history");
  });

  it("removes obsolete Data page sections and their server queries", () => {
    for (const title of ["Custom-field comparison", "Unresolved custom fields", "Manual custom-field mappings", "Person identity review", "Online Learning status classifications"]) {
      expect(panel).not.toContain(`title="${title}"`);
    }
    expect(page).not.toContain('supabase.from("wrike_normalized_custom_fields")');
    expect(page).not.toContain('supabase.from("wrike_workflow_statuses")');
    expect(page).not.toContain('supabase.from("wrike_manual_mappings")');
    expect(page).not.toContain('supabase.from("wrike_person_identities")');
  });

  it("clears only organization-scoped run logs through an administrator endpoint", () => {
    expect(historyRoute).toContain("requireAdmin()");
    expect(historyRoute).toContain('rpc("clear_wrike_run_history"');
    expect(historyRoute).toContain("profile.organization_id");
    expect(historyMigration).toContain("delete from public.wrike_vertical_repair_runs");
    expect(historyMigration).toContain("delete from public.wrike_folder_task_import_runs");
    expect(historyMigration).toContain("where organization_id = target_organization_id");
    expect(historyMigration).not.toContain("delete from public.wrike_tasks");
  });

  it("keeps successful outcomes concise and visible after a reload", () => {
    expect(panel).toContain('sessionStorage.setItem("devtrack-data-message"');
    expect(panel).toContain("Import complete —");
    expect(panel).toContain("Vertical repair complete —");
    expect(panel).not.toContain("Import complete:");
    expect(page).toContain("Wrike connected — ready to import.");
  });
});
