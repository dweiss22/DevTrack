import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  INITIAL_SURVEY_DEFINITIONS,
  applyContextBindings,
  normalizeCurrency,
  orderedQuestions,
  surveyDefinitionSchema,
  validateSurveyAnswers,
} from "@/lib/surveys/definition";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/202607300001_complete_survey_management.sql");
const runtimeFixMigration = source("supabase/migrations/202608030001_fix_survey_template_runtime.sql");
const browseFixMigration = source("supabase/migrations/202608030002_fix_survey_browse_runtime.sql");
const browseLabelFixMigration = source("supabase/migrations/202608030005_fix_native_survey_browse_labels.sql");
const ratings = (count: number) => Object.fromEntries(
  Array.from({ length: count }, (_, index) => [
    `rating${String(index + 1).padStart(2, "0")}`,
    5,
  ]),
);

describe("standard survey definitions", () => {
  it("keeps the application and database standard definitions identical", () => {
    const seeded = [...migration.matchAll(
      /\$definition\$\s*([\s\S]*?)\s*\$definition\$::jsonb/g,
    )].map((match) => JSON.parse(match[1]));
    expect(seeded).toEqual([
      INITIAL_SURVEY_DEFINITIONS.course_development_debrief,
      INITIAL_SURVEY_DEFINITIONS.id_sme_review,
    ]);
  });

  it("publishes the exact SME context, question order, wording, and descending display", () => {
    const definition = INITIAL_SURVEY_DEFINITIONS.course_development_debrief;
    expect(definition.title).toBe("Lexipol Course Development Debrief");
    expect(surveyDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(orderedQuestions(definition).map((question) => question.id)).toEqual([
      "smeName", "smeEmail", "smeClassification", "reportingYear",
      "billableHours", "amountBilled", "invoice", "workStartedOn",
      "workFinishedOn", "rating01", "rating02", "rating03", "rating04",
      "rating05", "rating06", "rating07", "rating08", "rating09",
      "rating10", "comments",
    ]);
    const context = definition.sections[0].questions;
    expect(context.map((question) => question.contextBinding)).toEqual([
      "smeName", "smeEmail", "smeClassification", "reportingYear",
    ]);
    expect(context.every((question) => !question.required)).toBe(true);
    const ratingQuestions = definition.sections
      .flatMap((section) => section.questions)
      .filter((question) => question.id.startsWith("rating"));
    expect(ratingQuestions).toHaveLength(10);
    expect(ratingQuestions[0].scale?.labels).toEqual([
      "Strongly Disagree", "Disagree", "Neither Agree nor Disagree",
      "Agree", "Strongly Agree",
    ]);
    expect(ratingQuestions.every((question) =>
      question.scale?.displayOrder === "descending")).toBe(true);
    expect(ratingQuestions[9].helpText).toBe(
      "I would recommend that my peers work with Lexipol for future SME opportunities.",
    );
  });

  it("publishes five ID context values, nine ratings, required decisions, and no new legacy follow-up", () => {
    const definition = INITIAL_SURVEY_DEFINITIONS.id_sme_review;
    expect(definition.title).toBe("ID Review of SME");
    expect(surveyDefinitionSchema.safeParse(definition).success).toBe(true);
    const questions = orderedQuestions(definition);
    expect(questions.slice(0, 5).map((question) => question.contextBinding)).toEqual([
      "respondentName", "courseName", "reviewedSmeName", "vertical", "reportingYear",
    ]);
    expect(questions.filter((question) => question.id.startsWith("rating"))).toHaveLength(9);
    expect(questions.find((question) => question.id === "rating01")?.scale).toMatchObject({
      min: 1,
      max: 5,
      minDescription: "It really wasn’t up to par.",
      maxDescription: "Absolutely knocked it out of the park—beyond what we hoped for.",
    });
    expect(questions.find((question) =>
      question.id === "providedRealWorldExamples")?.required).toBe(true);
    expect(questions.find((question) =>
      question.id === "recommendationScore")?.scale).toMatchObject({ min: 0, max: 10 });
    expect(questions.some((question) =>
      question.id === "realWorldExamplesEffectiveness")).toBe(false);
  });

  it("normalizes currency precisely and validates required new answer shapes", () => {
    expect(normalizeCurrency("00012.4")).toBe("12.40");
    expect(normalizeCurrency(0.1)).toBe("0.10");
    expect(normalizeCurrency("12.345")).toBeNull();
    expect(normalizeCurrency("-1.00")).toBeNull();

    const sme = validateSurveyAnswers(
      INITIAL_SURVEY_DEFINITIONS.course_development_debrief,
      {
        internalEmployee: false,
        billableHours: 12.5,
        amountBilled: "001250.5",
        workStartedOn: "2026-06-01",
        workFinishedOn: "2026-06-30",
        ...ratings(10),
        comments: "",
      },
      new Set(["invoice"]),
    );
    expect(sme.success).toBe(true);
    expect(sme.answers.amountBilled).toBe("1250.50");

    const id = validateSurveyAnswers(INITIAL_SURVEY_DEFINITIONS.id_sme_review, {
      ...ratings(9),
      providedRealWorldExamples: false,
      recommendationScore: 10,
      comments: "",
    });
    expect(id.success).toBe(true);
  });

  it("always replaces forged browser context with trusted values", () => {
    const applied = applyContextBindings(
      INITIAL_SURVEY_DEFINITIONS.id_sme_review,
      {
        respondentName: "Forged ID",
        courseName: "Forged course",
        reviewedSmeName: "Forged SME",
        vertical: "Other",
        reportingYear: 1999,
      },
      {
        respondentName: "Alex Reviewer",
        taskTitle: "Authoritative course",
        reviewedSmeName: "Jordan SME",
        vertical: "P1A",
        reportingYear: 2027,
      },
    );
    expect(applied).toMatchObject({
      respondentName: "Alex Reviewer",
      courseName: "Authoritative course",
      reviewedSmeName: "Jordan SME",
      vertical: "P1A",
      reportingYear: 2027,
    });
  });
});

describe("complete survey database and interface contract", () => {
  it("qualifies the template viewer lookup so the RETURNS TABLE id is not ambiguous", () => {
    expect(runtimeFixMigration).toContain("select member.* into viewer");
    expect(runtimeFixMigration).toContain("where member.id=public.current_effective_user_id()");
    expect(runtimeFixMigration).toContain("grant execute on function public.survey_admin_templates()");
    expect(runtimeFixMigration).toContain("perform public.seed_default_survey_templates(organization_record.id)");
  });

  it("qualifies the unified browse viewer lookup so the RETURNS TABLE id is not ambiguous", () => {
    expect(browseFixMigration).toContain("select member.* into viewer");
    expect(browseFixMigration).toContain("where member.id=public.current_effective_user_id()");
    expect(browseFixMigration).toContain("grant execute on function public.survey_browse_unified");
    expect(browseFixMigration).toContain("select pg_notify('pgrst','reload schema')");
  });

  it("labels native submissions from task and field-derived SME context", () => {
    expect(browseLabelFixMigration).toContain(
      "coalesce(survey.context_snapshot->>'taskTitle',",
    );
    expect(browseLabelFixMigration).toContain(
      "survey.context_snapshot#>>'{reviewedSme,name}'",
    );
    expect(browseLabelFixMigration).toContain("reviewed.display_name");
  });

  it("uses completed classification, completed_at, timezone dates, and an inclusive six-month cutoff", () => {
    expect(migration).toContain("status.dashboard_classification");
    expect(migration).toContain("classification is distinct from 'completed'");
    expect(migration).toContain("task_record.completed_at is null");
    expect(migration).toContain("at time zone organization_timezone");
    expect(migration).toContain("completed_on+interval '6 months'");
    expect(migration).toContain("local_today<=available_through");
    expect(migration).toContain("survey_sme_availability_at");
    expect(migration).toContain("from public,anon,authenticated");
  });

  it("seeds one identical immutable standard version idempotently with a system audit actor", () => {
    expect(migration).toContain("version.definition=seeded_definition");
    expect(migration).toContain("version.version_origin='published'");
    expect(migration).toContain("lock_version=lock_version+1");
    expect(migration).toContain("'seed_upgraded','system'");
    expect(migration).toContain("actor_id is null");
    expect(migration).toContain("perform public.seed_default_survey_templates(organization_record.id)");
  });

  it("guards builder operations by capability and synchronizes both rating shapes", () => {
    expect(migration.match(/current_has_capability\('manage_surveys'\)/g)?.length)
      .toBeGreaterThanOrEqual(7);
    expect(migration).toContain("new.answers->>'rating01'");
    expect(migration).toContain("new.answers#>>'{collaborationRatings,rating01}'");
    expect(migration).toContain("add column if not exists reporting_year integer");
    expect(migration).toContain("round(amount_text::numeric,2)::text");
  });

  it("keeps submitted ownership readable while expired drafts remain unavailable", () => {
    expect(migration).toContain("survey.status='submitted'");
    expect(migration).toContain("survey.subject_application_user_id=viewer.id");
    expect(migration).toContain("survey.created_by=viewer.id");
    expect(migration).toContain("survey.status='draft'");
    expect(migration).toContain("public.survey_sme_status_available(survey.task_id)");
    expect(migration).toContain("public.is_sme_identity_assigned");
  });

  it("exposes builder preview, endpoint guidance, and availability UI fields", () => {
    const designer = source("components/survey-designer.tsx");
    const renderer = source("components/survey-renderer.tsx");
    const personal = source("components/personal-survey-list.tsx");
    expect(designer).toContain("Preview SME type");
    expect(designer).toContain("displayOrder");
    expect(designer).toContain("minDescription");
    expect(renderer).toContain('displayOrder === "descending"');
    expect(renderer).toContain("minDescription");
    expect(personal).toContain("available_through");
    expect(personal).toContain("reviewed_sme_identity_id");
  });
});
