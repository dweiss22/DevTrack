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
const dashboardDrilldownMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607200001_dashboard_chart_drilldown.sql"), "utf8");
const developmentDashboardMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607200002_development_reporting_dashboard.sql"), "utf8");
const verticalNormalizationMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607200003_controlled_vertical_normalization.sql"), "utf8");
const reportingPerformanceMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607200004_reporting_course_dashboard_performance.sql"), "utf8");
const allYearsDashboardMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607200005_dashboard_all_reporting_years.sql"), "utf8");
const allYearsDrilldownMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607200006_all_years_dashboard_drilldown.sql"), "utf8");
const currentWrikeUserNamesMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607200007_current_wrike_user_names.sql"), "utf8");
const ignoredFolderReferencesMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607200008_ignore_out_of_scope_folder_references.sql"), "utf8");
const reportingFilterOptionsPerformanceMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607200009_reporting_filter_options_performance.sql"), "utf8");
const verticalCompletenessMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607210001_vertical_completeness_and_repair.sql"), "utf8");
const projectLengthPercentileMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607210003_project_length_percentile.sql"), "utf8");
const projectsListExperienceMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607210004_projects_list_experience.sql"), "utf8");
const projectsPercentilePerformanceMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607210005_projects_percentile_performance.sql"), "utf8");
const organizationWideReportingMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607210006_organization_wide_reporting_access.sql"), "utf8");
const projectsMultiselectMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607220001_projects_multiselect_filters.sql"), "utf8");
const personIdentityMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607220002_wrike_person_identities.sql"), "utf8");
const sortableProjectTablesMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607220003_sortable_project_tables.sql"), "utf8");
const courseTypeFilteringMigration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202607220004_course_type_filtering.sql"), "utf8");

function sqlFunctionDefinition(sql: string, name: string) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  expect(start, `${name} is defined`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", sql.indexOf("as $$", start));
  expect(end, `${name} definition terminates`).toBeGreaterThan(start);
  return sql.slice(start, end + 3);
}
describe("reporting migration contract", () => {
  it("exposes only observed accessible Course Type values with multiselect matching", () => {
    expect(courseTypeFilteringMigration).toContain("field.normalized_key='course type'");
    expect(courseTypeFilteringMigration).toContain("join visible_tasks task on task.id=task_value.task_id");
    expect(courseTypeFilteringMigration).toContain("jsonb_each(requested)");
    expect(courseTypeFilteringMigration).toContain("selected.value=any(field_value.display_values)");
    expect(courseTypeFilteringMigration).not.toContain("allowed_values");
  });

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
  it("preserves derived dashboard buckets when drilling into Projects", () => {
    expect(dashboardDrilldownMigration).toContain("matches_reporting_dashboard_drilldown");
    expect(dashboardDrilldownMigration).toContain("reportingYear");
    expect(dashboardDrilldownMigration).toContain("dashboardClassification");
    expect(dashboardDrilldownMigration).toContain("'Multiple Authoring Tools'");
    expect(dashboardDrilldownMigration).toContain("'Cross Vertical'");
    expect(dashboardDrilldownMigration).toContain("reporting_filtered_tasks_without_dashboard_drilldown");
  });
  it("provides indexed, centralized Development reporting-year analytics and rows", () => {
    expect(developmentDashboardMigration).toContain("generated always as (public.wrike_reporting_year(display_values)) stored");
    expect(developmentDashboardMigration).toContain("reporting_development_filtered_tasks");
    expect(developmentDashboardMigration).toContain("reporting_development_year_options");
    expect(developmentDashboardMigration).toContain("reporting_development_analytics");
    expect(developmentDashboardMigration).toContain("reporting_development_project_rows");
    expect(developmentDashboardMigration).toContain("IEACHQK7K4BHMLHM");
    expect(developmentDashboardMigration).toContain("current status until status-at-entry is persisted");
    expect(developmentDashboardMigration).toContain("grant execute on function public.reporting_development_analytics(jsonb) to authenticated,service_role");
  });
  it("enforces controlled Vertical normalization and separate reporting filters", () => {
    expect(verticalNormalizationMigration).toContain("normalized_verticals text[]");
    expect(verticalNormalizationMigration).toContain("vertical_reporting_category text");
    expect(verticalNormalizationMigration).toContain("has_unresolved_vertical boolean");
    expect(verticalNormalizationMigration).toContain("unresolved_vertical_tokens text[]");
    expect(verticalNormalizationMigration).toContain("('EMS1A','EMS1',5)");
    expect(verticalNormalizationMigration).toContain("using gin(normalized_verticals)");
    expect(verticalNormalizationMigration).toContain("enforce_wrike_vertical_normalization");
    expect(verticalNormalizationMigration).toContain("associatedVertical");
    expect(verticalNormalizationMigration).toContain("verticalReportingCategory");
    expect(verticalNormalizationMigration).toContain("unresolvedVerticalOnly");
  });
  it("strictly parses Reporting course years and scopes dashboard work before time aggregation", () => {
    expect(reportingPerformanceMigration).toContain("Courses$','i'");
    expect(reportingPerformanceMigration).toContain("reporting_dashboard_year_options");
    expect(reportingPerformanceMigration).toContain("reporting_online_learning_dashboard_overview_v3");
    expect(reportingPerformanceMigration).toContain("reporting_online_learning_dashboard_time_v3");
    expect(reportingPerformanceMigration).toContain("with completed as materialized");
    expect(reportingPerformanceMigration).toContain("with candidates as materialized");
    expect(reportingPerformanceMigration).toContain("reload schema");
  });
  it("aggregates the main Dashboard across all valid Reporting Years", () => {
    expect(allYearsDashboardMigration).toContain("reporting_online_learning_dashboard_tasks()");
    expect(allYearsDashboardMigration).toContain("reporting.reporting_year is not null and not reporting.has_conflict");
    expect(allYearsDashboardMigration).toContain("reporting_online_learning_dashboard_overview_v4()");
    expect(allYearsDashboardMigration).toContain("group by reporting_year");
    expect(allYearsDashboardMigration).toContain("reporting_online_learning_dashboard_time_v4()");
    expect(allYearsDashboardMigration).toContain("with completed as materialized");
    expect(allYearsDashboardMigration).toContain("reload schema");
  });
  it("keeps all-years Dashboard drill-downs scoped to valid Reporting values", () => {
    expect(allYearsDrilldownMigration).toContain("validReportingYearOnly");
    expect(allYearsDrilldownMigration).toContain("reporting.reporting_year is not null and not reporting.has_conflict");
    expect(allYearsDrilldownMigration).toContain("reporting_filtered_tasks_without_dashboard_drilldown");
    expect(allYearsDrilldownMigration).toContain("reload schema");
  });
  it("aligns persisted selected-user names with current Wrike responses", () => {
    expect(currentWrikeUserNamesMigration).toContain("wrike_id='KUANTWID'");
    expect(currentWrikeUserNamesMigration).toContain("display_name='Koço Budo'");
    expect(currentWrikeUserNamesMigration).toContain("wrike_id='KUAQCQMG'");
    expect(currentWrikeUserNamesMigration).toContain("display_name='Jeffrey Dino'");
    expect(currentWrikeUserNamesMigration).toContain("Raw API payloads remain unchanged");
  });
  it("removes and ignores configured out-of-scope folder references", () => {
    for (const id of ["IEACHQK7I4PFONLA", "IEACHQK7I4PFONKX", "IEACHQK7I4PFONKR", "IEACHQK7I7777777"]) expect(ignoredFolderReferencesMigration).toContain(id);
    expect(ignoredFolderReferencesMigration).toContain("delete from public.wrike_task_locations");
    expect(ignoredFolderReferencesMigration).toContain("Original task raw_data is preserved");
    expect(ignoredFolderReferencesMigration).toContain("resolution_status='ignored'");
  });
  it("resolves custom-field filter access once with set-based restricted access", () => {
    expect(reportingFilterOptionsPerformanceMigration).toContain("reporting_accessible_task_ids");
    expect(reportingFilterOptionsPerformanceMigration).toContain("has_unrestricted_organization_access");
    expect(reportingFilterOptionsPerformanceMigration).toContain("source_matches as materialized");
    expect(reportingFilterOptionsPerformanceMigration).toContain("people_matches as materialized");
    expect(reportingFilterOptionsPerformanceMigration).toContain("join visible_tasks visible_task");
    expect(reportingFilterOptionsPerformanceMigration).toContain("security definer");
    expect(reportingFilterOptionsPerformanceMigration).not.toContain("public.can_access_wrike_task(task.id)");
  });
  it("tracks custom-field completeness, five Vertical states, explicit repair audits, and administrator diagnostics", () => {
    for (const state of ["resolved", "cross_vertical", "missing", "unrecognized", "synchronization_incomplete"]) expect(verticalCompletenessMigration).toContain(state);
    for (const alias of ["GENERAL", "CROSS VERTICAL", "CROSS-VERTICAL", "ALL VERTICALS"]) expect(verticalCompletenessMigration).toContain(alias);
    expect(verticalCompletenessMigration).toContain("custom_fields_sync_diagnostics");
    expect(verticalCompletenessMigration).toContain("wrike_vertical_repair_runs");
    expect(verticalCompletenessMigration).toContain("reporting_vertical_data_quality");
    expect(verticalCompletenessMigration).toContain("vertical repair runs admin read");
    expect(verticalCompletenessMigration).toContain("verticalState");
  });
  it("calculates same-length project percentiles inside viewer reporting boundaries", () => {
    expect(projectLengthPercentileMigration).toContain("reporting_project_length_percentile");
    expect(projectLengthPercentileMigration).toContain("security invoker");
    expect(projectLengthPercentileMigration).toContain("reporting_accessible_task_ids()");
    expect(projectLengthPercentileMigration).toContain("can_access_wrike_time_entry(entry.id)");
    expect(projectLengthPercentileMigration).toContain("not task.is_deleted");
    expect(projectLengthPercentileMigration).toContain("not entry.is_deleted");
    expect(projectLengthPercentileMigration).toContain("task.custom_fields_sync_state='complete'");
    expect(projectLengthPercentileMigration).toContain("wrike_course_length_value_minutes");
  });
  it("batches Projects percentiles and restores OR-based Vertical selection matching", () => {
    expect(projectsListExperienceMigration).toContain("reporting_project_length_percentiles(target_task_ids uuid[])");
    expect(projectsListExperienceMigration).toContain("target_task_ids[1:200]");
    expect(projectsListExperienceMigration).toContain("security invoker");
    expect(projectsListExperienceMigration).toContain("reporting_accessible_task_ids()");
    expect(projectsListExperienceMigration).toContain("can_access_wrike_time_entry(entry.id)");
    expect(projectsListExperienceMigration).toContain("rank() over (partition by length_minutes order by minutes)-1");
    expect(projectsListExperienceMigration).toContain("jsonb_array_elements_text(filters->'verticalSelections')");
    expect(projectsListExperienceMigration).toContain("matches_reporting_vertical_filters(filtered.task_id,filters)");
  });
  it("resolves percentile task and timelog access once instead of per entry", () => {
    expect(projectsPercentilePerformanceMigration).toContain("wrike_time_entries_task_user_minutes_active_idx");
    expect(projectsPercentilePerformanceMigration).toContain("security definer");
    expect(projectsPercentilePerformanceMigration).toContain("candidate_groups as materialized");
    expect(projectsPercentilePerformanceMigration).toContain("source_matches as materialized");
    expect(projectsPercentilePerformanceMigration).toContain("person_rules as materialized");
    expect(projectsPercentilePerformanceMigration).toContain("visible_entry_totals as materialized");
    expect(projectsPercentilePerformanceMigration).toContain("reporting_accessible_task_ids()");
    expect(projectsPercentilePerformanceMigration).not.toContain("can_access_wrike_time_entry");
    expect(projectsPercentilePerformanceMigration).toContain("reload schema");
  });
  it("supports OR selections within Projects filters and AND semantics across fields", () => {
    expect(projectsMultiselectMigration).toContain("jsonb_each(requested)");
    expect(projectsMultiselectMigration).toContain("jsonb_array_elements_text");
    expect(projectsMultiselectMigration).toContain("selected.value=any(field_value.display_values)");
    expect(projectsMultiselectMigration).toContain("matches_reporting_year_selections");
    expect(projectsMultiselectMigration).toContain("'reportingYears'");
    expect(projectsMultiselectMigration).toContain("matches_reporting_vertical_filters(filtered.task_id,filters)");
  });
  it("stores person displayability independently from Wrike verification", () => {
    expect(personIdentityMigration).toContain("create table if not exists public.wrike_person_identities");
    expect(personIdentityMigration).toContain("is_displayable boolean not null");
    expect(personIdentityMigration).toContain("is_verified boolean not null");
    for (const source of ["wrike_contact", "email_match", "task_name", "configured_fallback", "manual_mapping", "unresolved"]) expect(personIdentityMigration).toContain(source);
    for (const status of ["unverified", "verified", "ambiguous", "not_found", "failed"]) expect(personIdentityMigration).toContain(status);
    expect(personIdentityMigration).toContain("unique (organization_id,identity_key)");
    expect(personIdentityMigration).toContain("last_verification_attempt_at timestamptz");
    expect(personIdentityMigration).toContain("next_verification_attempt_at timestamptz");
    expect(personIdentityMigration).toContain("verification_attempt_count integer");
    expect(personIdentityMigration).toContain("first_name text");
    expect(personIdentityMigration).toContain("contact_deleted boolean");
    expect(personIdentityMigration).toContain("last_verified_at timestamptz");
  });
  it("sorts both project tables across all six visible columns and both directions", () => {
    expect(sortableProjectTablesMigration).toContain("reporting_project_sort_percentiles(target_task_ids uuid[])");
    expect(sortableProjectTablesMigration).toContain("array_agg(requested_id order by ordinal) as task_ids");
    expect(sortableProjectTablesMigration).toContain("reporting_project_length_percentiles(batches.task_ids)");
    expect(sortableProjectTablesMigration).toContain("create or replace function public.reporting_task_rows");
    expect(sortableProjectTablesMigration).toContain("create or replace function public.reporting_development_project_rows");
    for (const key of ["title", "status", "vertical", "designer", "folders", "percentile"]) {
      expect(sortableProjectTablesMigration).toContain(`settings.sort_key='${key}'`);
    }
    expect(sortableProjectTablesMigration).toContain("settings.direction='asc'");
    expect(sortableProjectTablesMigration).toContain("settings.direction='desc'");
    expect(sortableProjectTablesMigration).toContain("limit greatest(1,least(result_limit,200)) offset greatest(0,result_offset)");
  });
  it("makes synchronized reporting organization-wide while preserving cross-organization RLS", () => {
    expect(organizationWideReportingMigration).toContain('create policy "organization reporting task read"');
    expect(organizationWideReportingMigration).toContain('create policy "organization reporting time entry read"');
    expect(organizationWideReportingMigration).toContain("wrike_time_entries_org_task_minutes_active_idx");
    expect(organizationWideReportingMigration).toContain("organization_id=(select public.current_organization_id())");
    expect(organizationWideReportingMigration).toContain('create policy "deprecated reporting groups admin read"');
    expect(organizationWideReportingMigration).toContain("Deprecated compatibility setting");
    expect(organizationWideReportingMigration).not.toContain("drop table public.reporting_group");
    expect(organizationWideReportingMigration).not.toContain("delete from public.reporting_group");
    expect(initialMigration).toContain('create policy "connection admin access" on public.wrike_connections');
    expect(organizationWideReportingMigration).not.toContain("on public.wrike_connections");
    expect(organizationWideReportingMigration).not.toContain("on public.reporting_conversations");
    expect(organizationWideReportingMigration).not.toContain("on public.reporting_messages");
  });
  it("removes reporting-group and per-row permission work from priority reporting RPCs", () => {
    for (const name of [
      "reporting_accessible_task_ids()",
      "reporting_filtered_tasks_without_dashboard_drilldown(filters",
      "reporting_time_rows(filters",
      "reporting_time_summary(filters",
      "reporting_online_learning_dashboard_tasks()",
      "reporting_online_learning_dashboard_time_v4()",
      "reporting_development_filtered_tasks(filters",
      "reporting_development_year_options()",
      "reporting_custom_field_options()",
      "reporting_project_length_percentiles(target_task_ids"
    ]) {
      const definition = sqlFunctionDefinition(organizationWideReportingMigration, name);
      expect(definition).not.toContain("reporting_group");
      expect(definition).not.toContain("reporting_access_enforced");
      expect(definition).not.toContain("can_access_wrike_task");
      expect(definition).not.toContain("can_access_wrike_time_entry");
    }
  });
});
