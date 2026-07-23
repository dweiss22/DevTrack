import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  colleagueReviewLabel, dashboardReturnHref, submissionHref, surveyActionLabel, surveyHref,
} from "@/lib/dashboards/domain";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/202607230005_role_aware_sme_id_dashboards.sql");

describe("role-aware dashboard behavior", () => {
  it("provides every survey action state and keeps colleague reviews read-only", () => {
    expect(surveyActionLabel(null, "survey")).toBe("Start survey");
    expect(surveyActionLabel({ id: "1", status: "draft", isLocked: false, revisionNumber: 1 }, "review")).toBe("Resume review");
    expect(surveyActionLabel({ id: "1", status: "submitted", isLocked: true, revisionNumber: 1 }, "review")).toBe("View submitted review");
    expect(surveyActionLabel({ id: "1", status: "submitted", isLocked: false, canEdit: true, revisionNumber: 2 }, "review")).toBe("Revise review");
    expect(colleagueReviewLabel({ id: "1", status: "draft", isLocked: false, revisionNumber: 1, creatorName: "Jane Smith" })).toBe("View Jane Smith’s draft");
  });

  it("builds project-scoped survey links and limits return navigation", () => {
    expect(surveyHref("task", "id-sme-review", "person", "/id-dashboard?id=person"))
      .toContain("/projects/task/surveys/id-sme-review?");
    expect(submissionHref("submission", "/surveys")).toContain("/surveys/submission?");
    expect(submissionHref("submission", "/id-dashboard", true)).toContain("readOnly=1");
    expect(dashboardReturnHref("/sme-dashboard?sme=1", "/surveys")).toBe("/sme-dashboard?sme=1");
    expect(dashboardReturnHref("https://evil.example", "/surveys")).toBe("/surveys");
  });

  it("adds centralized capabilities, navigation, and protected routes", () => {
    const roles = source("lib/auth/roles.ts");
    expect(roles).toContain('"view_id_dashboard"');
    expect(roles).toContain('"select_id_dashboard_user"');
    expect(source("lib/navigation.ts")).toContain('href: "/id-dashboard"');
    expect(source("middleware.ts")).toContain('"/id-dashboard/:path*"');
    expect(source("app/id-dashboard/page.tsx")).toContain('requirePageCapability("view_id_dashboard")');
  });

  it("uses assignment-driven caller-aware RPCs and verified identity mappings", () => {
    for (const fn of [
      "course_development_person_assignments", "reporting_sme_dashboard_identities",
      "reporting_sme_dashboard_rows", "reporting_current_id_identity",
      "reporting_id_dashboard_identities", "reporting_id_dashboard_rows", "survey_browse",
    ]) {
      expect(migration).toContain(`function public.${fn}`);
      expect(migration).toContain(`revoke all on function public.${fn}`);
    }
    expect(migration).toContain("identity_verified");
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("target_reviewed_wrike_user_id");
    expect(migration).toContain("survey.created_by<>viewer.id");
  });

  it("maps both ID and SME accounts without adding a role system", () => {
    expect(source("components/user-management-panel.tsx")).toContain('member.role === "sme" || member.role === "id"');
    expect(source("app/api/admin/users/[id]/wrike-identity/route.ts")).toContain('requireCapability("manage_users")');
    expect(migration).toContain("role in ('id','sme')");
  });

  it("renders separate project/SME review rows and mobile cards", () => {
    expect(source("components/id-dashboard.tsx")).toContain("row.task_id}:${row.reviewed_wrike_user_id");
    expect(source("components/id-dashboard.tsx")).toContain("colleague_reviews");
    expect(source("lib/dashboards/domain.ts")).toContain("Start review");
    expect(source("app/globals.css")).toContain(".dashboard-project-table td::before");
  });
});
