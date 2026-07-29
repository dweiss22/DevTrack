import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SmeDashboard, type SmeDashboardRow } from "@/components/sme-dashboard";
import type { DashboardIdentity } from "@/lib/dashboards/domain";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/202607290001_field_derived_sme_dashboard_identities.sql");

const fieldOnlyIdentity: DashboardIdentity = {
  identity_key: "sme:11111111-1111-5111-a111-111111111111",
  sme_identity_id: "11111111-1111-5111-a111-111111111111",
  wrike_user_id: null,
  application_user_id: null,
  display_name: "Morgan Field Expert",
  email: null,
  mapping_status: "unmapped",
  identity_status: "discovered",
  selectable: true,
};

const row: SmeDashboardRow = {
  task_id: "22222222-2222-4222-8222-222222222222",
  title: "Field-owned course",
  status_name: "In progress",
  status_color: "#145b9e",
  status_classification: "active",
  reporting_year: 2026,
  start_date: "2026-01-01",
  original_due_date: "2026-03-01",
  due_date: "2026-03-15",
  completed_at: null,
  actual_minutes: 120,
  is_overdue: false,
  subject_application_user_id: null,
  submission_id: null,
  survey_status: null,
  survey_is_locked: null,
  survey_can_edit: null,
  is_recent: true,
  submitted_billable_hours: null,
  submitted_amount_billed: null,
  submitted_at: null,
};

describe("field-derived SME dashboard identities", () => {
  it("renders an SME discovered only from a project field and associates its project", () => {
    const html = renderToStaticMarkup(<SmeDashboard
      identities={[fieldOnlyIdentity]} selected={fieldOnlyIdentity} rows={[row]}
      canSelect canLaunchDebrief={false} currentUserId={null} scope="all"
      administrativeView mappingRequired={false}
    />);
    expect(html).toContain("Morgan Field Expert");
    expect(html).toContain(fieldOnlyIdentity.sme_identity_id);
    expect(html).toContain("Field-owned course");
    expect(html).not.toContain("verified Wrike");
  });

  it("discovers all non-empty SME field values without requiring Wrike or app users", () => {
    expect(migration).toContain("field.normalized_key='sme'");
    expect(migration).toContain("course_development_person_tokens(field_value.display_values)");
    expect(migration).toContain("public.stable_sme_dashboard_identity_id");
    expect(migration).toContain("resolution_status");
    expect(migration).toContain("wrike_user_id uuid");
    expect(migration).toContain("application_user_id uuid");
    expect(migration).not.toMatch(/join public\.wrike_users identity[\s\S]{0,200}where task\.organization_id[\s\S]{0,100}insert into public\.sme_dashboard_identities/);
  });

  it("groups only equivalent normalized names and preserves display spellings", () => {
    expect(migration).toContain("group by normalized_name");
    expect(migration).toContain("array_agg(distinct display_name order by display_name)");
    expect(migration).toContain("unique (organization_id,normalized_name)");
    expect(migration).toContain("observed_names");
    expect(migration).toContain("md5(target_organization_id::text||':sme-field:'||normalized_sme_name)");
  });

  it("does not silently merge ambiguous names or conflicting field sources", () => {
    expect(migration).toContain("multiple_verified_wrike_name_matches");
    expect(migration).toContain("conflicting_sme_custom_field_sources");
    expect(migration).toContain("source_has_conflict");
    expect(migration).toContain("identity.resolution_status<>'ambiguous'");
    expect(migration).toContain("Confirmation is required to replace or resolve this SME identity linkage.");
  });

  it("attaches verified Wrike SMEs to the same field identity without duplicate dashboards", () => {
    expect(migration).toContain("one_sme_identity_per_wrike_user_idx");
    expect(migration).toContain("public.normalize_project_assignment_name(identity.display_name)=grouped.normalized_name");
    expect(migration).toContain("Attach legacy verified mappings without creating a second dashboard.");
  });

  it("allows selectors to list all discovered SMEs while restricting personal browsing", () => {
    expect(migration).toContain("public.current_has_capability('select_sme_dashboard_user')");
    expect(migration).toContain("or identity.id=own_identity");
    expect(migration).toContain("else public.current_sme_dashboard_identity()");
    expect(source("app/sme-dashboard/page.tsx")).toContain("reporting_sme_dashboard_rows_by_identity");
    expect(source("components/sme-dashboard.tsx")).toContain("canonicalIdentities.map");
  });

  it("links application accounts without moving historical project or survey ownership", () => {
    expect(migration).toContain("link_application_user_sme_identity");
    expect(migration).toContain("'preservedProjectHistory',true");
    expect(migration).toContain("'preservedSurveyHistory',true");
    expect(migration).toContain("survey.sme_identity_id=selected_identity");
    expect(migration).toContain("confirmed_replacement");
    expect(source("components/user-management-panel.tsx")).toContain("SME account links");
    expect(source("components/user-management-panel.tsx")).toContain("confirmReplacement");
  });

  it("preserves submitted-response privacy and billing restrictions", () => {
    expect(migration).toContain("survey.status='draft'");
    expect(migration).toContain("not survey.is_locked");
    expect(migration).toContain("public.current_has_management_role('admin')");
    expect(migration).toContain("response.internal_employee=false");
    expect(migration).toContain("survey_sme_submission_receipt");
  });
});
