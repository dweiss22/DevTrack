import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGREEMENT_SCALE, COLLABORATION_SCALE, EXAMPLE_EFFECTIVENESS_SCALE,
  ID_REVIEW_STATEMENTS, SME_DEBRIEF_STATEMENTS, debriefDraftSchema,
  idReviewDraftSchema, validateInvoiceFile,
} from "@/lib/surveys/domain";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/202607230004_course_development_surveys.sql");
const completeRatings = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`rating${String(index + 1).padStart(2, "0")}`, 5]));

describe("course-development survey contracts", () => {
  it("contains every exact matrix statement and scale", () => {
    expect(SME_DEBRIEF_STATEMENTS).toHaveLength(10);
    expect(ID_REVIEW_STATEMENTS).toHaveLength(9);
    expect(AGREEMENT_SCALE).toEqual(["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"]);
    expect(COLLABORATION_SCALE).toEqual(["Needs Improvement", "Below Expectations", "Meets Expectations", "Above Expectations", "Exceeds Expectations"]);
    expect(EXAMPLE_EFFECTIVENESS_SCALE).toHaveLength(5);
    expect(SME_DEBRIEF_STATEMENTS[9]).toContain("recommend my peers");
    expect(ID_REVIEW_STATEMENTS[8]).toContain("accessible and engaging");
  });

  it("validates debrief date order, future dates, ratings, and comment length", () => {
    const valid = { originalDueYear: 2026, internalEmployee: true, billableHours: "", amountBilled: "", workStartedOn: "2026-01-10", workFinishedOn: "2026-01-10", ...completeRatings(10), comments: "" };
    expect(debriefDraftSchema.safeParse(valid).success).toBe(true);
    const reversed = debriefDraftSchema.safeParse({ ...valid, workFinishedOn: "2026-01-09" });
    expect(reversed.success).toBe(false);
    if (!reversed.success) expect(reversed.error.issues[0].message).toBe("The finish date must be the same as or later than the start date.");
    expect(debriefDraftSchema.safeParse({ ...valid, rating10: 6 }).success).toBe(false);
    expect(debriefDraftSchema.safeParse({ ...valid, comments: "x".repeat(5001) }).success).toBe(false);
  });

  it("validates every ID rating, recommendation range, and fallback years", () => {
    const valid = { publicationYear: 2038, vertical: "Cross Vertical", ...completeRatings(9), providedRealWorldExamples: true, realWorldExamplesEffectiveness: 5, recommendationScore: 10, comments: "" };
    expect(idReviewDraftSchema.safeParse(valid).success).toBe(true);
    expect(idReviewDraftSchema.safeParse({ ...valid, publicationYear: 999 }).success).toBe(false);
    expect(idReviewDraftSchema.safeParse({ ...valid, rating09: 0 }).success).toBe(false);
    expect(idReviewDraftSchema.safeParse({ ...valid, recommendationScore: 11 }).success).toBe(false);
  });

  it("checks invoice extensions, MIME types, size, and detected signatures", () => {
    expect(validateInvoiceFile("invoice.pdf", "application/pdf", Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).toBeNull();
    expect(validateInvoiceFile("invoice.png", "image/png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    expect(validateInvoiceFile("invoice.jpg", "image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBeNull();
    expect(validateInvoiceFile("invoice.exe", "application/octet-stream", Uint8Array.from([1, 2, 3]))).toContain("PDF");
    expect(validateInvoiceFile("invoice.pdf", "application/pdf", Uint8Array.from([1, 2, 3]))).toContain("detected");
    expect(validateInvoiceFile("invoice.pdf", "image/png", Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).toContain("does not match");
  });
});

describe("survey persistence and security migration", () => {
  it("adds typed tables, duplicate keys, constraints, and original-date preservation", () => {
    for (const table of ["survey_submissions", "course_development_debrief_responses", "id_sme_review_responses", "survey_attachments", "survey_revisions", "survey_audit_log"]) {
      expect(migration).toContain(`table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("survey_debrief_identity_idx");
    expect(migration).toContain("survey_id_review_identity_idx");
    expect(migration).toContain("survey_one_active_invoice_per_revision_idx");
    expect(migration).toContain("preserve_wrike_task_original_due_date");
    for (let index = 1; index <= 10; index++) expect(migration).toContain(`rating_${String(index).padStart(2, "0")}`);
  });

  it("derives caller identity and lifecycle state in transactional functions", () => {
    for (const fn of ["survey_context_for_task", "survey_create_or_resume", "survey_save", "survey_unlock", "survey_relock", "survey_assign_reviser", "survey_correct_context"]) {
      expect(migration).toContain(`function public.${fn}`);
      expect(migration).toContain(`revoke all on function public.${fn}`);
    }
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("length(btrim(coalesce(unlock_reason_text,'')))=0");
    expect(migration).toContain("response_snapshot");
    expect(migration).toContain("revision_number=next_revision");
  });

  it("isolates roles and keeps private object keys out of authenticated grants", () => {
    expect(migration).toContain("viewer.role='sme' and survey.survey_type='course_development_debrief'");
    expect(migration).toContain("viewer.role='id' and survey.survey_type='id_sme_review'");
    expect(migration).toContain("survey.survey_type='id_sme_review' and viewer.role='id'");
    expect(migration).toContain("survey.revision_assignee_id=viewer.id");
    expect(migration).toContain("grant select(id,submission_id,organization_id,revision_number");
    expect(migration).not.toMatch(/grant select on public\.survey_attachments to authenticated/);
    expect(migration).toContain("'survey-invoices','survey-invoices',false");
    expect(migration).toContain('create policy "authorized survey invoice read"');
  });

  it("records every required audit event and uses short-lived downloads", () => {
    for (const event of ["draft_created", "draft_updated", "submitted", "unlocked", "edited_after_unlock", "resubmitted", "relocked", "revision_access_reassigned", "context_corrected", "invoice_uploaded", "invoice_removed", "invoice_replaced"]) expect(migration).toContain(`'${event}'`);
    const download = source("app/api/surveys/[id]/invoice/[attachmentId]/download/route.ts");
    expect(download).toContain("createSignedUrl");
    expect(download).toContain("expiresIn: 60");
  });
});

describe("route-backed accessible survey experience", () => {
  it("provides canonical/intercepted routes and role-aware launch points", () => {
    expect(source("app/@modal/(.)projects/[id]/surveys/[surveyType]/page.tsx")).toContain("<SurveyDialog");
    expect(source("app/projects/[id]/surveys/[surveyType]/page.tsx")).toContain("survey_context_for_task");
    expect(source("app/surveys/page.tsx")).toContain('requirePageCapability("view_surveys")');
    expect(source("components/sme-dashboard.tsx")).toContain('"course-development-debrief"');
    expect(source("app/projects/[id]/page.tsx")).toContain('surveyHref(id, "id-sme-review"');
    expect(source("app/projects/[id]/page.tsx")).toContain("assignedIdControls?.assigned");
  });

  it("implements modal, unsaved, critical-operation, semantic, and mobile behavior", () => {
    const component = source("components/survey-dialog.tsx");
    const css = source("app/globals.css");
    expect(component).toContain("showModal()");
    expect(component).toContain('addEventListener("beforeunload"');
    expect(component).toContain("You have unsaved changes");
    expect(component).toContain("onCancel={onCancel}");
    expect(component).toContain("disabled={critical}");
    expect(component).toContain("<fieldset");
    expect(component).toContain("<legend>");
    expect(css).toContain(".survey-dialog::backdrop");
    expect(css).toContain("width: 100vw; height: 100dvh");
    expect(css).toContain("table.survey-matrix { display: block");
  });
});
