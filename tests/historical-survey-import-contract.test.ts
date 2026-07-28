import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/202607280010_historical_survey_imports.sql");
const reportingMigration = source("supabase/migrations/202607280011_historical_survey_reporting.sql");
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

  it("provides the staged Admin workflow, correction audit, and Admin-only survey provenance", () => {
    expect(panel).toContain("Upload historical survey CSVs");
    expect(panel).toContain("Survey Data Issues");
    expect(panel).toContain("Integrate ready rows");
    expect(panel).toContain("Corrected normalized answers");
    expect(panel).toContain("Confirm the historical assignment context");
    expect(rowRoute).toContain("survey_historical_import_resolution_audit");
    expect(columnRoute).toContain("column_mapping_confirmed");
    expect(surveyRoute).toContain("historicalImport:");
    expect(dialog).toContain("Historical import provenance");
    expect(source("app/api/admin/surveys/export/route.ts")).toContain("survey_historical_import_integrations");
    expect(source("app/api/admin/surveys/export/route.ts")).toContain("billable_hours");
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
