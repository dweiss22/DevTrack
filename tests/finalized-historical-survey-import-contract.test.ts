import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/202607290008_finalized_historical_survey_import.sql");
const stage = source("lib/surveys/finalized-historical-import-server.ts");
const panel = source("components/finalized-historical-survey-imports.tsx");

describe("finalized historical import persistence contract", () => {
  it("keeps historical responses normalized and independent from native submissions", () => {
    expect(migration).toContain("create table public.historical_survey_responses");
    expect(migration).toContain("create table public.historical_sme_debrief_responses");
    expect(migration).toContain("create table public.historical_id_sme_review_responses");
    expect(migration).not.toContain("alter table public.survey_submissions\n  alter column task_id drop not null");
  });

  it("enforces the stable duplicate key and preserves original identifiers", () => {
    expect(migration).toContain("unique (organization_id,survey_type,source_response_id)");
    expect(migration).toContain("original_source_response_id");
    expect(stage).toContain("historicalDuplicateKey");
    expect(stage).toContain("withinFile");
  });

  it("implements idempotent server-side finalization and row savepoints", () => {
    expect(migration).toContain("requested_idempotency_key uuid");
    expect(migration).toContain("for import_row in");
    expect(migration).toContain("exception when others");
    expect(migration).toContain("finalized_at is not null");
    expect(source("app/api/admin/survey-imports/[id]/integrate/route.ts"))
      .toContain("execute_finalized_historical_survey_import");
  });

  it("requires survey-management access for replacement", () => {
    expect(migration).toContain("current_has_capability('manage_surveys')");
    expect(source("app/api/admin/survey-imports/rows/[id]/finalized/route.ts"))
      .toContain("hasCapability(context.profile.access, \"manage_surveys\")");
    expect(migration).toContain("historical_survey_response_revisions");
  });

  it("retains audit essentials and clears nonessential raw cells after import", () => {
    expect(migration).toContain("raw_row=jsonb_build_object(");
    expect(migration).toContain("'sourceResponseId'");
    expect(migration).toContain("normalization_deltas");
    expect(migration).not.toContain("storage.from");
  });

  it("provides administrative RLS and a unified reporting source", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("current_has_capability(''manage_data'')");
    expect(migration).toContain("create or replace view public.survey_reporting_responses");
    expect(migration).toContain("create or replace function public.survey_browse_unified");
    expect(migration).toContain("from public.historical_survey_responses historical");
  });
});

describe("finalized historical import administrator workflow", () => {
  it("uses the dedicated page and removes the competing Data-page importer", () => {
    expect(source("app/admin/page.tsx")).toContain("/admin/survey-imports");
    expect(source("app/admin/page.tsx")).not.toContain("HistoricalSurveyImports");
    expect(source("components/admin-panel.tsx")).not.toContain("Historical survey imports");
    expect(source("app/api/admin/survey-imports/columns/[id]/route.ts")).toContain("status: 410");
    expect(source("app/api/admin/survey-imports/rows/[id]/route.ts")).toContain("status: 410");
  });

  it("shows all four stages, preview controls, explicit duplicates, and final counts", () => {
    for (const phrase of [
      "1. Select and inspect", "2. Preview and reconcile", "3. Confirm import", "4. Results",
      "Select all importable", "Import as a separate response", "Replace existing historical response",
      "Download CSV error report",
    ]) expect(panel).toContain(phrase);
  });

  it("provides exact templates and a schema guide", () => {
    const templateRoute = source("app/api/admin/survey-imports/templates/[id]/route.ts");
    expect(templateRoute).toContain("finalizedHistoricalTemplate");
    expect(panel).toContain("SME Debrief CSV template");
    expect(panel).toContain("ID Review of SME CSV template");
    expect(panel).toContain("Historical CSV schema guide");
  });

  it("uses formula-safe error reports", () => {
    const report = source("app/api/admin/survey-imports/[id]/errors/route.ts");
    expect(report).toContain("escapeCsvFormula");
    expect(report).toContain("originalValue");
    expect(report).toContain("normalizedValue");
  });

  it("supports later project association with an audited database function", () => {
    expect(source("app/api/admin/historical-surveys/[id]/project/route.ts"))
      .toContain("match_historical_survey_response_project");
    expect(migration).toContain("'project_matched','project_unmatched'");
  });
});
