import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IdDashboard, type IdDashboardRow } from "@/components/id-dashboard";
import { SmeDashboard, type SmeDashboardRow } from "@/components/sme-dashboard";
import type { DashboardIdentity } from "@/lib/dashboards/domain";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/202607290003_field_derived_id_dashboard_smes.sql");
const identityMigration = source("supabase/migrations/202607290001_field_derived_sme_dashboard_identities.sql");

const selectedId: DashboardIdentity = {
  identity_key: "wrike:99999999-9999-4999-8999-999999999999",
  wrike_user_id: "99999999-9999-4999-8999-999999999999",
  application_user_id: null,
  display_name: "Assigned Designer",
  email: null,
  mapping_status: "unmapped",
  identity_status: "verified",
  selectable: true,
};

const fieldIdentityId = "11111111-1111-5111-a111-111111111111";
const fieldOnlyRow: IdDashboardRow = {
  task_id: "22222222-2222-4222-8222-222222222222",
  title: "Field identity course",
  status_name: "In Development",
  status_classification: "active",
  reviewed_wrike_user_id: null,
  sme_identity_id: fieldIdentityId,
  reviewed_sme_name: "Jeff Dino",
  reviewed_sme_email: null,
  reviewed_sme_application_user_id: null,
  sme_mapping_status: "unmapped",
  sme_identity_status: "discovered",
  sme_assignment_values: ["Jeff Dino"],
  vertical: "Law Enforcement",
  course_style: "Full Length",
  publication_date: null,
  publication_year: null,
  reporting_year: 2026,
  original_due_date: "2026-01-01",
  due_date: "2026-02-01",
  completed_at: null,
  folder_context: "Courses",
  updated_at_wrike: null,
  own_review: null,
  colleague_reviews: [],
  finalized_draft: { available: false },
};

describe("field-derived SME resolution on the ID Dashboard", () => {
  it("removes identity context cards while retaining the SME period controls", () => {
    const idHtml = renderToStaticMarkup(<IdDashboard identities={[selectedId]} selected={selectedId}
      rows={[fieldOnlyRow]} canSelect canActAsAssignedId mappingRequired={false} ownOperationalView />);
    expect(idHtml).not.toContain("dashboard-identity-note");
    expect(idHtml).not.toContain("My assigned ID projects");
    expect(idHtml).not.toContain("Administrative ID view");
    expect(idHtml).not.toContain("Showing assignments for");

    const smeRow: SmeDashboardRow = {
      task_id: fieldOnlyRow.task_id, title: fieldOnlyRow.title,
      status_name: fieldOnlyRow.status_name, status_color: null,
      status_classification: "active", reporting_year: 2026,
      start_date: null, original_due_date: null, due_date: "2026-02-01",
      completed_at: null, actual_minutes: 0, is_overdue: false,
      subject_application_user_id: null, submission_id: null, survey_status: null,
      survey_is_locked: null, survey_can_edit: null, is_recent: true,
      submitted_billable_hours: null, submitted_amount_billed: null, submitted_at: null,
    };
    const smeIdentity: DashboardIdentity = {
      ...selectedId, identity_key: `sme:${fieldIdentityId}`, sme_identity_id: fieldIdentityId,
      wrike_user_id: null, display_name: "Jeff Dino", identity_status: "discovered",
    };
    const smeHtml = renderToStaticMarkup(<SmeDashboard identities={[smeIdentity]} selected={smeIdentity}
      rows={[smeRow]} canSelect canLaunchDebrief={false} currentUserId={null}
      scope="recent" administrativeView mappingRequired={false} />);
    expect(smeHtml).not.toContain("dashboard-identity-note");
    expect(smeHtml).not.toContain("Showing assignments for");
    expect(smeHtml).toContain("Project period");
    expect(smeHtml).toContain(">Recent<");
    expect(smeHtml).toContain(">All Time<");
    expect(source("app/globals.css")).not.toContain(".dashboard-identity-note");
  });

  it("shows a field-only SME as identified and starts review by durable identity", () => {
    const html = renderToStaticMarkup(<IdDashboard identities={[selectedId]} selected={selectedId}
      rows={[fieldOnlyRow]} canSelect canActAsAssignedId mappingRequired={false} ownOperationalView />);
    expect(html).toContain("Jeff Dino");
    expect(html).toContain("Start review");
    expect(html).toContain(`sme=${fieldIdentityId}`);
    expect(html).not.toContain("needs administrative resolution");
    expect(html).not.toContain("No DevTrack SME account");
  });

  it("resumes an identity-owned review without reverting to a Wrike SME", () => {
    const html = renderToStaticMarkup(<IdDashboard identities={[selectedId]} selected={selectedId}
      rows={[{ ...fieldOnlyRow, own_review: {
        id: "33333333-3333-4333-8333-333333333333",
        status: "draft", isLocked: false, revisionNumber: 1,
      } }]} canSelect canActAsAssignedId mappingRequired={false} ownOperationalView />);
    expect(html).toContain("Resume review");
    expect(html).toContain("/surveys/33333333-3333-4333-8333-333333333333");
  });

  it("uses the Project Details field identity source and returns one row per identity", () => {
    expect(migration).toContain("public.sme_dashboard_task_assignments sme_assignment");
    expect(migration).toContain("public.sme_dashboard_identities sme_identity");
    expect(migration).toContain("sme_identity.id");
    expect(migration).toContain("sme_identity.display_name");
    expect(migration).not.toContain("course_development_person_assignments_with_personas(\n    viewer.organization_id,'sme'");
    expect(identityMigration).toContain("from public.sme_dashboard_task_assignments assignment");
    expect(identityMigration).toContain("'smeIdentityId',identity.id");
  });

  it("matches new reviews by identity and retains historical Wrike-only reviews", () => {
    expect(migration).toContain("survey.sme_identity_id=sme_identity.id");
    expect(migration).toContain("survey.sme_identity_id is null");
    expect(migration).toContain("survey.reviewed_wrike_user_id=sme_identity.wrike_user_id");
    expect(migration).toContain("order by (survey.sme_identity_id=sme_identity.id) desc");
    expect(identityMigration).toContain("sme_identity_id,");
    expect(identityMigration).toContain("identity.wrike_user_id,identity.id");
    expect(source("app/api/surveys/route.ts")).toContain("target_sme_identity_id: parsed.data.reviewedSmeIdentityId");
    expect(source("components/survey-dialog.tsx")).toContain("reviewedSmeIdentityId: initialSmeIdentityId");
  });

  it("does not duplicate verified Wrike SMEs and blocks only real ambiguity or conflict", () => {
    expect(identityMigration).toContain("one_sme_identity_per_wrike_user_idx");
    expect(migration).toContain("when sme_assignment.source_has_conflict then 'conflict'");
    expect(migration).toContain("when sme_identity.resolution_status='ambiguous' then 'ambiguous'");
    for (const status of ["ambiguous", "conflict"] as const) {
      const html = renderToStaticMarkup(<IdDashboard identities={[selectedId]} selected={selectedId}
        rows={[{ ...fieldOnlyRow, sme_identity_status: status }]}
        canSelect canActAsAssignedId mappingRequired={false} ownOperationalView />);
      expect(html).toContain("needs administrative resolution");
      expect(html).not.toContain("Start review");
    }
  });

  it("preserves ID assignment and survey authorization boundaries", () => {
    expect(migration).toContain("viewer.role='id'");
    expect(migration).toContain("viewer.role not in ('super_admin','admin')");
    expect(migration).toContain("course_development_person_assignments_with_personas");
    expect(migration).toContain("where owner_assignment.wrike_user_id=target_wrike_user_id");
    expect(identityMigration).toContain("not public.is_course_development_person_assigned(");
    expect(identityMigration).toContain("not public.is_sme_identity_assigned(");
  });
});
