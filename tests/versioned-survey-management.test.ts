import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hasCapability } from "@/lib/auth/roles";
import { navigationForRole } from "@/lib/navigation";
import {
  INITIAL_SURVEY_DEFINITIONS,
  QUESTION_TYPES,
  questionIsVisible,
  surveyDefinitionSchema,
  validateSurveyAnswers,
} from "@/lib/surveys/definition";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/202607270001_versioned_survey_management.sql");

describe("versioned survey management", () => {
  it("supports every required safe question type and rejects forward conditional references", () => {
    expect(QUESTION_TYPES).toEqual([
      "short_text", "long_text", "number", "currency", "date", "yes_no",
      "single_choice", "multiple_choice", "rating_scale", "rating_matrix", "file_upload",
    ]);
    const invalid = structuredClone(INITIAL_SURVEY_DEFINITIONS.course_development_debrief);
    invalid.sections[0].questions[0].visibility = {
      match: "all", rules: [{ questionId: "comments", operator: "answered" }],
    };
    expect(surveyDefinitionSchema.safeParse(invalid).success).toBe(false);
    const executable = structuredClone(INITIAL_SURVEY_DEFINITIONS.id_sme_review);
    executable.introduction = '<script src="https://example.test/x.js"></script>';
    expect(surveyDefinitionSchema.safeParse(executable).success).toBe(false);
    const incompatible = structuredClone(INITIAL_SURVEY_DEFINITIONS.id_sme_review);
    incompatible.sections[1].questions[0].visibility = {
      match: "all", rules: [{ questionId: "vertical", operator: "greater_than", value: 1 }],
    };
    expect(surveyDefinitionSchema.safeParse(incompatible).success).toBe(false);
  });

  it("evaluates conditions, clears hidden requirements, and validates matrix rows", () => {
    const definition = INITIAL_SURVEY_DEFINITIONS.course_development_debrief;
    const invoice = definition.sections[1].questions[2];
    expect(questionIsVisible(invoice, { internalEmployee: true })).toBe(false);
    expect(questionIsVisible(invoice, { internalEmployee: false })).toBe(true);
    const result = validateSurveyAnswers(definition, {
      originalDueYear: 2026, internalEmployee: true,
      workStartedOn: "2026-01-01", workFinishedOn: "2026-01-02",
      collaborationRatings: { rating01: 5 },
    });
    expect(result.errors.collaborationRatings).toContain("matrix");
    expect(result.errors.invoice).toBeUndefined();
  });

  it("separates personal and administrative navigation and route capabilities", () => {
    expect(hasCapability("sme", "view_personal_surveys")).toBe(true);
    expect(hasCapability("id", "view_personal_surveys")).toBe(true);
    expect(hasCapability("admin", "view_personal_surveys")).toBe(false);
    expect(hasCapability("admin", "manage_surveys")).toBe(true);
    expect(navigationForRole("admin").find((entry) => entry.kind === "link" && entry.id === "admin-surveys")?.href).toBe("/admin/surveys");
    expect(navigationForRole("sme").some((entry) => entry.kind === "link" && entry.href === "/admin/surveys")).toBe(false);
    expect(source("middleware.ts")).toContain('pathname.startsWith("/api/admin/surveys")');
  });

  it("builds draft concurrency, publishing, preview, duplication, and archive controls", () => {
    const designer = source("components/survey-designer.tsx");
    const templates = source("components/admin-survey-templates.tsx");
    expect(designer).toContain("expectedLockVersion");
    expect(designer).toContain("Publish new version");
    expect(designer).toContain("<SurveyRenderer");
    expect(designer).toContain("Add condition");
    expect(designer).toContain("Add section");
    expect(templates).toContain('"duplicate"');
    expect(templates).toContain('"archive"');
    expect(templates).toContain('"restore"');
  });

  it("uses caller-derived assignments and uniform personal start input", () => {
    const start = source("app/api/surveys/route.ts");
    expect(start).toContain('requireCapability("view_personal_surveys")');
    expect(start).toContain('"survey_personal_create_or_resume"');
    expect(start).not.toContain("smeApplicationUserId");
    expect(migration).toContain("viewer.wrike_user_id is null");
    expect(migration).toContain("assignment.wrike_user_id=viewer.wrike_user_id");
    expect(migration).toContain("target_reviewed_wrike_user_id");
    expect(migration).toContain("message='Survey context is unavailable.'");
  });

  it("pins drafts, makes published definitions immutable, and retains submitted file objects", () => {
    expect(migration).toContain("prevent_published_survey_version_changes");
    expect(migration).toContain("before update or delete on public.survey_template_versions");
    expect(migration).toContain("pin_current_survey_version_before_insert");
    expect(migration).toContain("definition_snapshot");
    expect(migration).toContain("answers_snapshot");
    expect(migration).toContain("survey_register_attachment");
    expect(migration).toContain("survey_remove_attachment");
    expect(migration).toContain("revoke insert,update,delete on public.survey_submissions");
    const attachments = source("lib/surveys/attachment-http.ts");
    expect(migration).toContain("case when survey.status='draft' then attachment.object_key else null end");
    expect(attachments).toContain('storage.from("survey-invoices").remove');
    expect(attachments).toContain('"survey_register_attachment"');
  });

  it("keeps personal completed responses read-only and excludes revision assignment", () => {
    const page = source("app/surveys/page.tsx");
    const dialog = source("components/survey-dialog.tsx");
    const actions = source("app/api/admin/surveys/submissions/[id]/actions/route.ts");
    expect(page).toContain("Incomplete");
    expect(page).toContain("Completed");
    expect(page).toContain("Continue survey");
    expect(page).toContain("Review answers");
    expect(dialog).toContain("readOnly={!editable}");
    expect(actions).not.toContain("assign_reviser");
    expect(migration).toContain("survey.status='draft'");
    expect(migration).toContain("viewer.role in ('super_admin','admin')");
  });
});
