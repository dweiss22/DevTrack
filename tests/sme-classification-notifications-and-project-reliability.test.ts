import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  INITIAL_SURVEY_DEFINITIONS,
  applyContextBindings,
  surveyDefinitionSchema,
} from "@/lib/surveys/definition";
import { smeClassificationSchema } from "@/lib/smes/domain";
import { loadSmeProjectDetail } from "@/lib/smes/project-detail";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/202607280006_sme_classification_notifications_and_project_reliability.sql");

describe("SME account classification and trusted debrief context", () => {
  it("accepts only the two audited classifications and keeps existing accounts nullable", () => {
    expect(smeClassificationSchema.safeParse("internal").success).toBe(true);
    expect(smeClassificationSchema.safeParse("external").success).toBe(true);
    expect(smeClassificationSchema.safeParse(null).success).toBe(false);
    expect(migration).toContain("classification text check (classification in ('internal','external'))");
    expect(migration).toContain("select distinct member.id,member.organization_id,null::text,null::uuid");
    expect(migration).toContain("application_user_sme_profile_audit");
  });

  it("removes editable trusted questions and rejects attempts to add them back", () => {
    const definition = INITIAL_SURVEY_DEFINITIONS.course_development_debrief;
    const ids = definition.sections.flatMap((section) => section.questions.map((question) => question.id));
    expect(ids).not.toContain("internalEmployee");
    expect(ids).not.toContain("originalDueYear");

    const manipulated = structuredClone(definition);
    manipulated.sections[0].questions.push({
      id: "reportingYear",
      type: "number",
      label: "Reporting Year",
      helpText: "",
      required: false,
      width: "half",
      validation: {},
    });
    expect(surveyDefinitionSchema.safeParse(manipulated).success).toBe(false);
    expect(migration).toContain("reserve_sme_context_in_template_drafts");
    expect(migration).toContain("reserve_sme_context_in_template_versions");
  });

  it("derives read-only context from the trusted classification and reporting year", () => {
    const definition = INITIAL_SURVEY_DEFINITIONS.course_development_debrief;
    expect(applyContextBindings(definition, {
      internalEmployee: true,
      originalDueYear: 1999,
    }, {
      smeClassification: "external",
      reportingYear: 2027,
    })).toMatchObject({ internalEmployee: false });
    expect(migration).toContain("public.sme_debrief_configuration");
    expect(migration).toContain("public.is_course_development_person_assigned");
    expect(migration).toContain("value.reporting_year");
    expect(migration).not.toContain("task_record.original_due_date)::integer");
  });

  it("strips manipulated internal billing and preserves submitted snapshots", () => {
    expect(migration).toContain("raw_answers:=(raw_answers-'billableHours'-'amountBilled')");
    expect(migration).toContain("and survey.status='draft'");
    expect(migration).toContain("private_object_deletion_queue");
    expect(migration).toContain("'sme_reclassified_internal'");
  });
});

describe("durable Coordinator debrief notifications", () => {
  it("enqueues one delivery per active same-organization Coordinator in the submission transaction", () => {
    expect(migration).toContain("unique(event_id,recipient_application_user_id)");
    expect(migration).toContain("unique(submission_id,revision_number,event_type)");
    expect(migration).toContain("grant_row.management_role='sme_coordinator'");
    expect(migration).toContain("recipient.account_state='active'");
    expect(migration).toContain("grant_row.organization_id=survey.organization_id");
  });

  it("uses stable provider idempotency and leaves exhausted failures manually retryable", () => {
    const notification = source("lib/notifications/sme-debrief.ts");
    const provider = source("lib/notifications/resend.ts");
    expect(notification).toContain("idempotencyKey: delivery.delivery_id");
    expect(provider).toContain('"idempotency-key"');
    expect(migration).toContain("when attempts>=5 then 'exhausted'");
    expect(migration).toContain("delivery.status<>'delivered'");
    expect(source("app/api/admin/surveys/submissions/[id]/notifications/route.ts"))
      .toContain("retry_sme_debrief_notification_delivery");
  });

  it("keeps Internal messages free of billing and uses a protected invoice fallback", () => {
    const notification = source("lib/notifications/sme-debrief.ts");
    expect(notification).toContain('if (payload.classification === "external")');
    expect(notification).toContain("/api/sme-management/surveys/");
    expect(notification).not.toContain("getPublicUrl");
  });
});

describe("one assignment-safe SME project loader", () => {
  it("ignores an ordinary SME's client-supplied identity", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        state: "allowed",
        taskId: "09dab4bc-7c60-48d1-88b5-312c610a5b51",
        selectedSmeWrikeUserId: "11111111-1111-4111-8111-111111111111",
      },
      error: null,
    });
    const result = await loadSmeProjectDetail({
      supabase: { rpc } as never,
      projectId: "09dab4bc-7c60-48d1-88b5-312c610a5b51",
      requestedSme: "393c8c02-fd3a-4025-a74b-8169f63e913a",
      canSelect: false,
    });
    expect(result?.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("sme_project_detail", {
      target_task_id: "09dab4bc-7c60-48d1-88b5-312c610a5b51",
      target_sme_wrike_user_id: null,
    });
  });

  it("rejects malformed selected identities before the database call", async () => {
    const rpc = vi.fn();
    const result = await loadSmeProjectDetail({
      supabase: { rpc } as never,
      projectId: "09dab4bc-7c60-48d1-88b5-312c610a5b51",
      requestedSme: "not-a-uuid",
      canSelect: true,
    });
    expect(result).toEqual({ ok: false, state: "identity_unavailable" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses identical loaders for direct and intercepted routes and distinguishes database failures", () => {
    const direct = source("app/sme-dashboard/projects/[projectId]/page.tsx");
    const modal = source("app/@modal/(.)sme-dashboard/projects/[projectId]/page.tsx");
    const loader = source("lib/smes/project-detail.ts");
    expect(direct).toContain("loadSmeProjectDetail");
    expect(modal).toContain("loadSmeProjectDetail");
    expect(direct).toContain('result.state === "not_found"');
    expect(modal).toContain('result.state === "not_found"');
    expect(loader).toContain("sme_project_detail_failed");
    expect(migration).toContain("'state','not_assigned'");
    expect(migration).toContain("'state','not_found'");
  });
});
