import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { finalizedCourseDraftUrlSchema } from "@/lib/projects/finalized-draft";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/202607230008_restricted_sme_projects_and_finalized_drafts.sql");
const smeProject = source("app/sme-dashboard/projects/[projectId]/page.tsx");
const internalProject = source("app/projects/[id]/page.tsx");
const smeDashboard = source("components/sme-dashboard.tsx");
const idDashboard = source("components/id-dashboard.tsx");

describe("restricted SME projects and assigned-ID actions", () => {
  it("routes an SME to a dedicated project page backed by one restricted RPC", () => {
    expect(smeDashboard).toContain("/sme-dashboard/projects/${row.task_id}");
    expect(smeProject).toContain('rpc("sme_project_detail"');
    expect(smeProject).not.toContain('from("wrike_tasks")');
    for (const prohibited of ["Open in Wrike", "raw_data", "wrike_time_entries", "ID review", "survey_audit_log"]) {
      expect(smeProject).not.toContain(prohibited);
    }
  });

  it("returns only the SME's own debrief and approved project fields", () => {
    expect(migration).toContain("survey.subject_application_user_id=viewer.id");
    for (const field of ["'title'", "'status'", "'reportingYear'", "'assignedIds'", "'vertical'", "'courseLength'", "'legalReviewer'", "'debrief'", "'finalizedDraft'"]) {
      expect(migration).toContain(field);
    }
    expect(smeProject).toContain("Create SME Debrief");
    expect(smeProject).toContain("Resume SME Debrief");
    expect(smeProject).toContain("View Submitted Debrief");
    expect(smeProject).toContain("Revise SME Debrief");
    expect(source("app/api/surveys/context/route.ts")).toContain("taskWrikeId: _taskWrikeId");
    expect(source("app/api/surveys/context/route.ts")).toContain("assignment.applicationUserId === user.id");
    expect(source("lib/surveys/server.ts")).toContain("surveyDetailForSme");
  });

  it("keeps assigned-ID controls off administrator-selected dashboard views", () => {
    expect(idDashboard).toContain("canActAsAssignedId");
    expect(idDashboard).toContain("canActAsAssignedId\n                  ?");
    expect(internalProject).toContain('profile.role === "id"');
    expect(internalProject).toContain('rpc("assigned_id_project_controls"');
    expect(internalProject).not.toContain('hasCapability(profile.role, "create_id_review")');
    expect(internalProject).not.toContain('hasCapability(profile.role, "manage_surveys")');
  });

  it("requires the authenticated ID's trusted project assignment for review and draft mutations", () => {
    expect(migration).toContain("viewer.role<>'id'");
    expect(migration).toContain("assignment.wrike_user_id=viewer.wrike_user_id");
    expect(migration).toContain("requested_type='id_sme_review' and viewer.role='id'");
    expect(migration).toContain("message='Survey context is unavailable.'");
  });

  it("stores finalized links privately with assignment evidence and append-only audit events", () => {
    expect(migration).toContain("create table public.project_finalized_course_drafts");
    expect(migration).toContain("create table public.project_finalized_course_draft_audit");
    expect(migration).toContain("assigned_id_wrike_user_id");
    expect(migration).toContain("revoke all on public.project_finalized_course_drafts from anon,authenticated");
    expect(migration).toContain("'created','updated','removed'");
    expect(migration).not.toContain("previous_url");
    expect(migration).not.toContain("new_url");
  });

  it("rejects unsafe finalized-course-draft URLs in browser and server schemas", () => {
    for (const invalid of [
      "http://example.com/course",
      "javascript:alert(1)",
      "data:text/plain,test",
      "file:///C:/course",
      "https://user:secret@example.com/course",
      "not a URL",
    ]) {
      expect(finalizedCourseDraftUrlSchema.safeParse(invalid).success, invalid).toBe(false);
    }
    expect(finalizedCourseDraftUrlSchema.safeParse("https://example.com/final/course").success).toBe(true);
    expect(migration).toContain("is_safe_finalized_course_draft_url");
    expect(migration).toContain("^https://");
  });

  it("renders locked and otherwise non-editable survey responses without form controls", () => {
    const dialog = source("components/survey-dialog.tsx");
    expect(dialog).toContain("!editable");
    expect(dialog).toContain("<ReadOnlySurveyResponse");
    expect(dialog).toContain("Submitted and locked");
    expect(dialog).toContain("survey-comment-readonly");
  });
});
