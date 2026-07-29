import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SmeDashboard, type SmeDashboardRow } from "@/components/sme-dashboard";
import { SmeProjectDetail, type SmeProjectDetailData } from "@/components/sme-project-detail";
import type { DashboardIdentity } from "@/lib/dashboards/domain";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/202607280005_strict_dashboard_assignments_and_sme_survey_lock.sql");
const smeMigration = source("supabase/migrations/202607280002_sme_management_experience.sql");
const idAnalyticsMigration = source("supabase/migrations/202607280004_id_dashboard_reporting_year_analytics.sql");

const identity: DashboardIdentity = {
  identity_key: "wrike:sme-1",
  wrike_user_id: "sme-1",
  application_user_id: "app-sme-1",
  display_name: "Taylor Expert",
  email: "taylor@example.com",
  mapping_status: "mapped",
  identity_status: "verified",
  selectable: true,
};

const submittedRow: SmeDashboardRow = {
  task_id: "11111111-1111-4111-8111-111111111111",
  title: "Assigned course",
  status_name: "Completed",
  status_color: "#0c8f78",
  status_classification: "completed",
  reporting_year: 2026,
  start_date: "2026-01-01",
  original_due_date: "2026-03-01",
  due_date: "2026-03-15",
  completed_at: "2026-03-10T12:00:00Z",
  actual_minutes: 180,
  is_overdue: false,
  subject_application_user_id: "app-sme-1",
  submission_id: "22222222-2222-4222-8222-222222222222",
  survey_status: "submitted",
  survey_is_locked: true,
  survey_can_edit: false,
  is_recent: true,
  submitted_billable_hours: null,
  submitted_amount_billed: null,
  submitted_at: "2026-07-28T19:15:00Z",
};

const submittedDetail: SmeProjectDetailData = {
  taskId: submittedRow.task_id,
  title: submittedRow.title,
  status: submittedRow.status_name,
  statusColor: submittedRow.status_color,
  reportingYear: 2026,
  assignedIds: [{ wrikeUserId: "id-1", name: "Jordan Designer" }],
  vertical: "Public Safety",
  courseLength: "60",
  legalReviewer: "Legal Reviewer",
  debrief: {
    status: "submitted",
    latestSubmittedAt: submittedRow.submitted_at,
  },
  finalizedDraft: { available: false },
  timeline: {
    startDate: submittedRow.start_date,
    originalDueDate: submittedRow.original_due_date,
    dueDate: submittedRow.due_date,
    completedAt: submittedRow.completed_at,
  },
  categoryTime: [],
  isRecent: true,
  selectedSmeWrikeUserId: "sme-1",
  subjectApplicationUserId: "app-sme-1",
};

describe("strict dashboard assignments and submitted SME survey lock", () => {
  it("resolves only exact, unambiguous names from the SME and ID Assigned custom fields", () => {
    expect(migration).toContain("field.normalized_key='sme'");
    expect(migration).toContain("field.normalized_key='id assigned'");
    expect(migration).toContain("cardinality(field_value.source_wrike_field_ids)>0");
    expect(migration).toContain("normalize_project_assignment_name(identity.display_name)");
    expect(migration).toContain("count(distinct candidate.wrike_user_id)=1");
    expect(migration).toContain("course_development_person_tokens(");
    expect(migration).toContain("field_value.display_values");
    expect(migration).toContain("public.normalize_project_assignment_name(role_value.value)<>''");
    expect(migration).not.toContain("public.wrike_task_assignees");
    expect(migration).not.toContain("'mapped_assignee'");
    expect(migration).not.toContain("lower(identity.wrike_id)");
    expect(migration).not.toContain("lower(coalesce(identity.email");
    expect(migration).not.toContain("ilike");
    expect(migration).not.toContain("similarity(");
  });

  it("routes every SME and ID dashboard dataset through the centralized strict resolver", () => {
    expect(migration).toContain("course_development_person_assignments_with_personas");
    expect(migration).not.toContain("operational_persona_assignee");
    expect(smeMigration).toContain("course_development_person_assignments(viewer.organization_id,'sme')");
    expect(smeMigration).toContain("target_wrike_user_id:=own_identity");
    expect(idAnalyticsMigration).toContain("course_development_person_assignments_with_personas");
    expect(source("supabase/migrations/202607240001_correct_id_dashboard_course_resolution.sql"))
      .toContain("course_development_person_assignments_with_personas");
    expect(source("supabase/migrations/202607270003_course_style_project_filter.sql"))
      .toContain("course_development_person_assignments_with_personas");
  });

  it("shows only a submitted receipt and timestamp on the SME Dashboard", () => {
    const html = renderToStaticMarkup(<SmeDashboard
      identities={[identity]}
      selected={identity}
      rows={[submittedRow]}
      canSelect={false}
      canLaunchDebrief
      currentUserId="app-sme-1"
      scope="recent"
      administrativeView={false}
      mappingRequired={false}
    />);
    expect(html).toContain("Survey received");
    expect(html).toContain("Submitted Jul 28, 2026");
    expect(html).not.toContain(`/surveys/${submittedRow.submission_id}`);
    expect(html).not.toContain("View submitted");
    expect(html).not.toContain("Resume survey");
  });

  it("allows an eligible draft to resume before submission", () => {
    const draft = {
      ...submittedRow,
      survey_status: "draft" as const,
      survey_is_locked: false,
      survey_can_edit: true,
      submitted_at: null,
    };
    const html = renderToStaticMarkup(<SmeDashboard
      identities={[identity]}
      selected={identity}
      rows={[draft]}
      canSelect={false}
      canLaunchDebrief
      currentUserId="app-sme-1"
      scope="recent"
      administrativeView={false}
      mappingRequired={false}
    />);
    expect(html).toContain("Resume survey");
    expect(html).toContain(`/surveys/${draft.submission_id}`);
    expect(html).not.toContain("Survey received");
  });

  it("removes submitted answers, billing, attachments, and links from the SME project view", () => {
    const html = renderToStaticMarkup(<SmeProjectDetail
      detail={submittedDetail}
      returnTo="/sme-dashboard"
      canLaunchSurvey
      managementView={false}
    />);
    expect(html).toContain("Survey received");
    expect(html).not.toContain("/surveys/");
    expect(html).not.toContain("View Submitted Debrief");
    expect(html).not.toContain("Billable hours");
    expect(html).not.toContain("Invoiced amount");
    expect(html).not.toContain("Agreement ratings");
    expect(html).not.toContain("Download invoice");
    expect(html).not.toContain("Comments");
    expect(html).not.toContain("Legal reviewer");
    expect(html).not.toContain("Legal Reviewer");
  });

  it("preserves full submitted-response rendering for an authorized Admin view", () => {
    const administrativeDetail: SmeProjectDetailData = {
      ...submittedDetail,
      debrief: {
        id: submittedRow.submission_id!,
        status: "submitted",
        isLocked: true,
        canEdit: false,
        revisionNumber: 1,
        latestSubmittedAt: submittedRow.submitted_at,
        response: {
          internalEmployee: false,
          billableHours: 4,
          amountBilled: 600,
          workStartedOn: "2026-01-10",
          workFinishedOn: "2026-01-12",
          ratings: [5, 5, 4, 4, 5, 5, 4, 5, 4, 5],
          comments: "Administrative response detail",
        },
        attachments: [{
          id: "33333333-3333-4333-8333-333333333333",
          filename: "invoice.pdf",
          sizeBytes: 1024,
          uploadedAt: submittedRow.submitted_at!,
        }],
      },
    };
    const html = renderToStaticMarkup(<SmeProjectDetail
      detail={administrativeDetail}
      returnTo="/sme-dashboard"
      canLaunchSurvey={false}
      managementView
    />);
    expect(html).toContain("Administrative response detail");
    expect(html).toContain("Billable hours");
    expect(html).toContain("Download invoice");
    expect(html).toContain("Legal reviewer");
    expect(html).toContain("Legal Reviewer");
  });

  it("denies SME retrieval after submission at RLS, route, API, attachment, and RPC boundaries", () => {
    expect(migration).toMatch(/survey\.survey_type='course_development_debrief'\s+and survey\.status='draft'/);
    expect(migration).toContain("survey_personal_create_or_resume_without_submitted_sme_lock");
    expect(migration).toContain("if existing_status='submitted'");
    expect(migration).toContain("result#>>'{debrief,status}'='submitted'");
    expect(migration).toContain("reporting_sme_dashboard_rows_with_sensitive_billing");
    expect(migration).toContain("revoke all on function public.sme_project_detail_with_submitted_responses");
    expect(source("app/surveys/[submissionId]/page.tsx")).toContain('rpc("can_view_survey"');
    expect(source("app/projects/[id]/surveys/[surveyType]/page.tsx"))
      .toContain('rpc("survey_sme_submission_receipt"');
    expect(source("app/api/surveys/[id]/attachments/[attachmentId]/download/route.ts"))
      .toContain('rpc("can_view_survey"');
    expect(source("app/api/surveys/[id]/invoice/[attachmentId]/download/route.ts"))
      .toContain('rpc("can_view_survey"');
  });

  it("keeps Admin and SuperAdmin response access while locking every historical SME submission", () => {
    expect(migration).toContain("public.current_has_management_role('admin')");
    expect(migration).toContain("public.current_has_management_role('super_admin')");
    expect(migration).toContain("survey.status='submitted'");
    expect(migration).not.toContain("survey.original_submitted_at>=");
    expect(migration).not.toContain("survey.created_at>=");
    expect(source("app/api/surveys/[id]/route.ts")).toContain('hasCapability(profile.access, "manage_surveys")');
  });
});
