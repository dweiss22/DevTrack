import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IdDashboard, type IdDashboardRow } from "@/components/id-dashboard";
import type { DashboardIdentity } from "@/lib/dashboards/domain";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/202607240001_correct_id_dashboard_course_resolution.sql");
const courseStyleMigration = source("supabase/migrations/202607270003_course_style_project_filter.sql");

const selected: DashboardIdentity = {
  identity_key: "wrike:id", wrike_user_id: "id", application_user_id: null,
  display_name: "Devin Weiss", email: "dweiss@example.com",
  mapping_status: "unmapped", identity_status: "verified", selectable: true,
};

const unresolvedSmeRow: IdDashboardRow = {
  task_id: "task", title: "Visible ID course", status_name: "In Development",
  status_classification: "active", reviewed_wrike_user_id: null,
  reviewed_sme_name: null, reviewed_sme_email: null,
  reviewed_sme_application_user_id: null, sme_mapping_status: null,
  sme_identity_status: "unresolved", sme_assignment_values: ["Example SME"],
  vertical: null, course_style: "Full Length", publication_date: null, publication_year: null,
  reporting_year: 2026, original_due_date: null, due_date: null,
  completed_at: null, folder_context: "2026 Courses", updated_at_wrike: null,
  own_review: null, colleague_reviews: [], finalized_draft: { available: false },
};

describe("corrected ID Dashboard course resolution", () => {
  it("matches canonical verified people and safely tokenizes multi-person values", () => {
    expect(migration).toContain("create extension if not exists unaccent");
    expect(migration).toContain("normalize_course_development_person_name");
    expect(migration).toContain("course_development_person_tokens");
    expect(migration).toContain("regexp_split_to_table");
    expect(migration).toContain("count(distinct candidate.wrike_user_id)=1");
    expect(migration).toContain("lower(coalesce(identity.email,''))");
  });

  it("keeps ID fields authoritative and assignees fallback-only", () => {
    expect(migration).toContain("tasks_with_role_fields");
    expect(migration).toContain("where not exists(");
    expect(migration).toContain("'mapped_assignee'::text");
    expect(migration).toContain("field.normalized_key in (\n      'instructional designer'");
  });

  it("retains a trusted ID course when its SME is unresolved", () => {
    expect(migration).toContain("left join public.course_development_person_assignments_with_personas");
    expect(migration).toContain("when cardinality(sme_evidence.assignment_values)>0 then 'unresolved'");
    expect(migration).toContain("sme_identity_status text,sme_assignment_values text[]");

    const html = renderToStaticMarkup(<IdDashboard identities={[selected]} selected={selected}
      rows={[unresolvedSmeRow]} canSelect canActAsAssignedId mappingRequired={false}
      ownOperationalView />);
    expect(html).toContain("Visible ID course");
    expect(html).toContain("Course Style");
    expect(html).toContain("Full Length");
    expect(html).toContain("SME identity needs resolution");
    expect(html).toContain("Wrike value: Example SME");
    expect(html).toContain("Resolve the SME assignment before starting a review.");
    expect(html).not.toContain("Start review");
  });

  it("shows the requested seven-column ID Dashboard table", () => {
    const html = renderToStaticMarkup(<IdDashboard identities={[selected]} selected={selected}
      rows={[unresolvedSmeRow]} canSelect canActAsAssignedId mappingRequired={false}
      ownOperationalView />);
    const headings = [...html.matchAll(/<th>(.*?)<\/th>/g)].map((match) => match[1]);
    expect(headings).toEqual([
      "Course Name", "SME", "Status", "Vertical", "Course Style", "Finalized Draft", "Survey",
    ]);
    expect(html).toContain('data-label="Course Name"');
    expect(html).toContain('data-label="SME"');
    expect(html).toContain('data-label="Survey"');
    expect(html).not.toContain("Review actions");
    expect(html).not.toContain("Publication / reporting");
    expect(html).not.toContain("Due / completed");
    expect(html).not.toContain("Project / folder");
  });

  it("preserves effective-user, persona, and principal-based security layers", () => {
    expect(migration).toContain("public.current_effective_user_id()");
    expect(migration).toContain("course_development_person_assignments_with_personas");
    expect(migration).toContain("join public.application_user_principals creator");
    expect(migration).toContain("survey.created_by=viewer.id");
  });

  it("loads recognized Course Style values through an organization-scoped batch RPC", () => {
    expect(courseStyleMigration).toContain("reporting_id_dashboard_course_styles");
    expect(courseStyleMigration).toContain("viewer.organization_id");
    expect(courseStyleMigration).toContain("public.current_id_operational_identity()");
    expect(courseStyleMigration).toContain("course_development_person_assignments_with_personas");
    expect(source("app/id-dashboard/page.tsx")).toContain('supabase.rpc("reporting_id_dashboard_course_styles"');
  });
});
