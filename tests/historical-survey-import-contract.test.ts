import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/202607280010_historical_survey_imports.sql");
const reportingMigration = source("supabase/migrations/202607280011_historical_survey_reporting.sql");
const identifierFixMigration = source("supabase/migrations/202607280012_fix_historical_survey_version_identifiers.sql");
const canonicalMigration = source("supabase/migrations/202607290007_canonical_historical_survey_csv.sql");
const stage = source("lib/surveys/historical-import-server.ts");
const dataPage = source("app/admin/page.tsx");
const panel = source("components/historical-survey-imports.tsx");
const rowRoute = source("app/api/admin/survey-imports/rows/[id]/route.ts");
const columnRoute = source("app/api/admin/survey-imports/columns/[id]/route.ts");
const surveyRoute = source("app/api/surveys/[id]/route.ts");
const dialog = source("components/survey-dialog.tsx");

describe("historical survey import security and persistence contract", () => {
  it("creates organization-scoped staged provenance and duplicate-upload records", () => {
    for (const table of [
      "survey_historical_import_batches", "survey_historical_import_upload_attempts",
      "survey_historical_import_column_mappings", "survey_historical_import_rows",
      "survey_historical_import_issues", "survey_historical_import_resolution_audit",
      "survey_historical_import_integrations",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain("alter table public.%I enable row level security");
    expect(migration).toContain("unique(organization_id,file_checksum)");
    expect(stage).toContain("duplicate_upload: true");
    expect(stage).toContain("fileChecksum");
  });

  it("retries an interrupted upload in place instead of returning an empty duplicate batch", () => {
    expect(stage).toContain('existingBatch.status === "staged" && !existingBatch.validated_at');
    expect(stage).toContain("survey_historical_import_issues\").delete().eq(\"batch_id\", batchId)");
    expect(stage).toContain("survey_historical_import_rows\").delete().eq(\"batch_id\", batchId)");
    expect(stage).toContain("survey_historical_import_column_mappings\").delete().eq(\"batch_id\", batchId)");
    expect(stage).toContain("duplicate_upload: resumableBatch");
  });

  it("limits every workflow to manage_data and protects import-only legacy versions", () => {
    expect(dataPage).toContain('requirePageCapability("manage_data")');
    expect(source("app/api/admin/survey-imports/route.ts")).toContain('requireCapability("manage_data")');
    expect(rowRoute).toContain('requireCapability("manage_data")');
    expect(columnRoute).toContain('requireCapability("manage_data")');
    expect(migration.match(/current_has_capability\('manage_data'\)/g)?.length).toBeGreaterThanOrEqual(6);
    expect(migration).toContain("version_origin='historical_import'");
    expect(migration).toContain("not template.is_import_only");
    expect(migration).toContain("and not template.is_import_only");
  });

  it("uses unambiguous identifiers when creating an import-only survey version", () => {
    expect(identifierFixMigration).toContain("target_template_id uuid");
    expect(identifierFixMigration).toContain("target_version_id uuid");
    expect(identifierFixMigration).toContain("next_version_number integer");
    expect(identifierFixMigration).toContain("on conflict on constraint survey_template_drafts_pkey do nothing");
    expect(identifierFixMigration).not.toMatch(/\n\s+template_id uuid;/);
    expect(identifierFixMigration).not.toContain("on conflict(template_id)");
  });

  it("supports non-login historical principals without creating operational access", () => {
    expect(migration).toContain("state in ('active','deleted','historical')");
    expect(migration).toContain("state='historical' and auth_user_id is null");
    expect(migration).toContain("historical_wrike_user_id");
    expect(migration).not.toContain("insert into public.application_user_operational_personas");
    expect(migration).not.toContain("insert into public.application_users");
  });

  it("promotes through canonical submissions, typed responses, immutable revisions, and audit history", () => {
    expect(migration).toContain("insert into public.survey_submissions");
    expect(migration).toContain("insert into public.course_development_debrief_responses");
    expect(migration).toContain("insert into public.id_sme_review_responses");
    expect(migration).toContain("insert into public.survey_revisions");
    expect(migration).toContain("insert into public.survey_audit_log");
    expect(migration).toContain("revision.answers_snapshot=import_row.normalized_answers");
    expect(migration).toContain("Historical survey persistence could not be verified.");
    expect(migration).toContain("submitted_at=source_time");
    expect(migration).toContain("created_at");
    expect(reportingMigration).toContain("debrief.reporting_year");
    expect(reportingMigration).not.toContain("debrief.original_due_year");
    expect(reportingMigration).toContain("join public.application_user_principals creator");
  });

  it("is idempotent, preserves repeat groups as explicit revisions, and blocks canonical collisions", () => {
    expect(stage).toContain("integratedFingerprints");
    expect(stage).toContain("canonical_identity_key");
    expect(stage).toContain('"repeat_identity"');
    expect(migration).toContain("integration.fingerprint=import_row.fingerprint");
    expect(migration).toContain("import_row.repeat_resolution<>'revision'");
    expect(migration).toContain("A canonical survey already exists for this identity.");
    expect(migration).toContain("order by canonical_identity_key");
  });

  it("never enqueues notifications and only rolls back untouched imported state", () => {
    expect(migration).not.toContain("insert into public.sme_debrief_notification_events");
    expect(migration).toContain("sme_debrief_notification_events where submission_id");
    expect(migration).toContain("Rollback is blocked because an imported submission was modified.");
    expect(migration).toContain("other_link.batch_id<>target_batch_id");
    expect(migration).toContain("historical_import_rolled_back");
  });

  it("preserves legacy audit provenance while retiring its mutation endpoints", () => {
    expect(panel).toContain("Upload historical survey CSVs");
    expect(panel).toContain("Reconciliation issues");
    expect(panel).toContain("Integrate ready rows");
    expect(panel).toContain("Corrected normalized answers");
    expect(panel).toContain("CSV templates and data dictionary");
    expect(panel).toContain("SearchableSelect");
    expect(panel).toContain("Confirm the historical assignment context");
    expect(rowRoute).toContain("status: 410");
    expect(rowRoute).toContain("Legacy historical row correction has been retired");
    expect(columnRoute).toContain("status: 410");
    expect(columnRoute).toContain("Legacy historical column mapping has been retired");
    expect(surveyRoute).toContain("historicalImport:");
    expect(dialog).toContain("Historical import provenance");
    expect(source("app/api/admin/surveys/export/route.ts")).toContain("survey_historical_import_integrations");
    expect(source("app/api/admin/surveys/export/route.ts")).toContain("billable_hours");
  });

  it("retains the exact published version and canonical conditional answer during integration", () => {
    expect(canonicalMigration).toContain("version_origin in (''historical_import'',''published'')");
    expect(canonicalMigration).toContain("realWorldExamplesEffectiveness");
    expect(canonicalMigration).toContain("normalized_answers\\s*->>\\s*''recommendationScore''");
    expect(canonicalMigration).toContain("real_world_examples_effectiveness\\s*=\\s*null(::smallint)?");
    expect(canonicalMigration).toContain("'gi'");
    expect(canonicalMigration).toContain("without changing survey ownership, privacy, or access");
  });

  it("uses exact project and person evidence and treats CourseKey only as suggestion context", () => {
    expect(stage).toContain("task.wrike_id === parsed.wrikeTaskId");
    expect(stage).toContain("normalizeHistoricalTitle(task.title) === normalizeHistoricalTitle(parsed.projectTitle)");
    expect(stage).toContain("projectSuggestions(parsed.projectTitle || parsed.projectKey");
    expect(stage).toContain("user.email?.trim().toLocaleLowerCase");
    expect(stage).toContain("normalizedName(user.display_name) === key");
    expect(stage).not.toContain(".includes(parsed.projectTitle");
  });
});
