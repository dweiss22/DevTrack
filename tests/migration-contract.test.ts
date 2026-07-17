import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607160002_reliable_reporting.sql"), "utf8");
const initialMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607160001_initial_schema.sql"), "utf8");
const spaceImportMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607160003_one_click_space_import.sql"), "utf8");
const folderImportMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607160004_folder_task_import.sql"), "utf8");
const metadataMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607160005_real_wrike_metadata.sql"), "utf8");
const combinedImportMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607170001_folder_task_timelog_import.sql"), "utf8");
const referenceDataMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607170002_wrike_reference_data.sql"), "utf8");
const customFieldNormalizationMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607170003_wrike_custom_field_normalization.sql"), "utf8");
const referenceResolutionMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607170004_wrike_reference_resolution.sql"), "utf8");
const dashboardAnalyticsMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607170005_dashboard_analytics.sql"), "utf8");
const dashboardPerformanceMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607170006_dashboard_query_performance.sql"), "utf8");
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
  it("preserves real folder and readable custom-field metadata", () => {
    expect(metadataMigration).toContain("child_wrike_ids text[]");
    expect(metadataMigration).toContain("enriched_metadata jsonb");
    expect(metadataMigration).toContain("option_values text[]");
    expect(metadataMigration).toContain("metadata_diagnostics jsonb");
    expect(metadataMigration).toContain("'title', coalesce(folder.title, project.title, l.wrike_location_id)");
  });
  it("supports reconciled folder tasks, historical timelogs, source mappings, and run diagnostics", () => {
    expect(combinedImportMigration).toContain("task_wrike_id text");
    expect(combinedImportMigration).toContain("user_wrike_id text");
    expect(combinedImportMigration).toContain("hours numeric");
    expect(combinedImportMigration).toContain("alter column task_id drop not null");
    expect(combinedImportMigration).toContain("on delete set null");
    expect(combinedImportMigration).toContain("table public.wrike_folder_timelog_imports");
    expect(combinedImportMigration).toContain("primary key (organization_id, folder_wrike_id, time_entry_id)");
    expect(initialMigration).toMatch(/wrike_time_entries[\s\S]*unique\s*\(organization_id,\s*wrike_id\)/);
    expect(combinedImportMigration).toContain("add column if not exists folder_id uuid references public.wrike_folders(id) on delete set null");
    expect(combinedImportMigration).toContain("task_request_contract jsonb");
    expect(combinedImportMigration).toContain("timelog_descendant_strategy");
    expect(combinedImportMigration).toContain("failed_folder_request_count");
    expect(combinedImportMigration).toContain("enable row level security");
    expect(combinedImportMigration).toContain("grant all on public.wrike_folder_timelog_imports to service_role");
  });
  it("stores reference data, raw responsible IDs, OAuth scopes, workflow status fields, and run warnings", () => {
    expect(referenceDataMigration).toContain("oauth_scopes text[]");
    expect(referenceDataMigration).toContain("title text");
    expect(referenceDataMigration).toContain("avatar_url text");
    expect(referenceDataMigration).toContain("profiles jsonb");
    expect(referenceDataMigration).toContain("hidden boolean");
    expect(referenceDataMigration).toContain("sort_order integer");
    expect(referenceDataMigration).toContain("responsible_wrike_ids text[]");
    expect(referenceDataMigration).toContain("jsonb_array_elements_text");
    expect(referenceDataMigration).toContain("table if not exists public.wrike_workflows");
    expect(referenceDataMigration).toContain("standard boolean");
    expect(referenceDataMigration).toContain("reference_data_diagnostics jsonb");
    expect(referenceDataMigration).toContain("reference_warning_count integer");
    expect(referenceDataMigration).toContain("enable row level security");
    expect(referenceDataMigration).toContain("grant all on public.wrike_workflows to service_role");
  });
  it("stores logical custom fields, raw source mappings, conflict metadata, dynamic options, and scoped access", () => {
    expect(customFieldNormalizationMigration).toContain("table public.wrike_normalized_custom_fields");
    expect(customFieldNormalizationMigration).toContain("unique (organization_id, normalized_key)");
    expect(customFieldNormalizationMigration).toContain("table public.wrike_normalized_custom_field_sources");
    expect(customFieldNormalizationMigration).toContain("custom_field_id uuid not null unique references public.wrike_custom_fields");
    expect(customFieldNormalizationMigration).toContain("source_designation text");
    expect(customFieldNormalizationMigration).toContain("table public.wrike_task_normalized_custom_field_values");
    expect(customFieldNormalizationMigration).toContain("source_wrike_field_ids text[]");
    expect(customFieldNormalizationMigration).toContain("source_titles text[]");
    expect(customFieldNormalizationMigration).toContain("has_conflict boolean");
    expect(customFieldNormalizationMigration).toContain("conflict_metadata jsonb");
    expect(customFieldNormalizationMigration).toContain("custom_field_conflict_count integer");
    expect(customFieldNormalizationMigration).toContain("reporting_custom_field_options");
    expect(customFieldNormalizationMigration).toContain("wanted.value=any(value.display_values)");
    expect(customFieldNormalizationMigration).toContain("matches_reporting_normalized_custom_search");
    expect(customFieldNormalizationMigration).toContain("public.can_access_wrike_task(task.id)");
    expect(customFieldNormalizationMigration).toContain("enable row level security");
  });
  it("tracks unresolved references, manual mappings, status classifications, and Online Learning dashboard integrity", () => {
    expect(referenceResolutionMigration).toContain("table if not exists public.wrike_unresolved_references");
    expect(referenceResolutionMigration).toContain("unique (organization_id,reference_type,wrike_id)");
    expect(referenceResolutionMigration).toContain("table if not exists public.wrike_manual_mappings");
    expect(referenceResolutionMigration).toContain("dashboard_classification text");
    expect(referenceResolutionMigration).toContain("classification_source text");
    expect(referenceResolutionMigration).toContain("workflow_record_id uuid references public.wrike_workflows");
    expect(referenceResolutionMigration).toContain("reporting_online_learning_dashboard");
    expect(referenceResolutionMigration).toContain("reporting_online_learning_status_summary");
    expect(referenceResolutionMigration).toContain("custom_status_value in (select jsonb_array_elements_text(requested))");
    expect(referenceResolutionMigration).toContain("unresolved reference admin access");
    expect(referenceResolutionMigration).toContain("manual mapping admin access");
  });
  it("aggregates the redesigned Online Learning dashboard without browser-side raw fact loading", () => {
    expect(dashboardAnalyticsMigration).toContain("reporting_online_learning_dashboard_v2");
    expect(dashboardAnalyticsMigration).toContain("IEACHQK7K4BHMLHM");
    expect(dashboardAnalyticsMigration).toContain("wrike_reporting_year");
    expect(dashboardAnalyticsMigration).toContain("visible_actual_minutes");
    expect(dashboardAnalyticsMigration).toContain("dashboard_classification='completed'");
    expect(dashboardAnalyticsMigration).toContain("'Multiple Authoring Tools'");
    expect(dashboardAnalyticsMigration).toContain("'Cross Vertical'");
    expect(dashboardAnalyticsMigration).toContain("wrike_tasks_workflow_active_idx");
    expect(dashboardAnalyticsMigration).toContain("grant execute on function public.reporting_online_learning_dashboard_v2(jsonb) to authenticated,service_role");
  });
  it("uses set-based time aggregation when organization-wide reporting access is available", () => {
    expect(dashboardPerformanceMigration).toContain("has_unrestricted_organization_access");
    expect(dashboardPerformanceMigration).toContain("group by entry.task_id");
    expect(dashboardPerformanceMigration).toContain("public.can_access_wrike_time_entry(entry.id)");
    expect(dashboardPerformanceMigration).toContain("alter function public.reporting_online_learning_dashboard_v2(jsonb) security definer");
    expect(dashboardPerformanceMigration).toContain("where task.organization_id=viewer_organization_id");
  });
});
