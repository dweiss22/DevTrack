import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseCourseLengthMinutes,
  percentileRank,
  percentileRankFromCounts,
  projectBenchmarkUnavailableMessage
} from "@/lib/reporting/project-overview";

const migration = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/202607290004_completed_style_percentiles.sql"),
  "utf8"
);

describe("completed duration-and-style Development Percentiles", () => {
  it("normalizes equivalent one- and two-hour representations but rejects ambiguous values", () => {
    for (const value of ["1 hour", "1.0 hours", "01:00", "60 minutes"]) {
      expect(parseCourseLengthMinutes(value)).toBe(60);
    }
    for (const value of ["2 hours", "2.0 hours", "02:00", "120 minutes"]) {
      expect(parseCourseLengthMinutes(value)).toBe(120);
    }
    expect(parseCourseLengthMinutes(["1 hour", "60 minutes"])).toBe(60);
    expect(parseCourseLengthMinutes(["1 hour", "2 hours"])).toBeNull();
    expect(parseCourseLengthMinutes("1")).toBeNull();
    expect(parseCourseLengthMinutes("2")).toBeNull();
    expect(parseCourseLengthMinutes("1.0")).toBeNull();
  });

  it("uses one conservative SQL duration parser and one conservative Course Style normalizer", () => {
    expect(migration).toContain("create or replace function public.wrike_course_length_value_minutes");
    expect(migration).toContain("create or replace function public.wrike_course_length_minutes");
    expect(migration).toContain("Unitless integers and decimals are deliberately ambiguous");
    expect(migration).toContain("result<>trunc(result)");
    expect(migration).toContain("create or replace function public.wrike_course_style_value");
    expect(migration).toContain("when 'full length' then 'Full Length'");
    expect(migration).toContain("when 'single video' then 'Single Video'");
    expect(migration).not.toMatch(/when 'full course' then/i);
    expect(migration).not.toMatch(/when 'microlearning' then/i);
  });

  it("requires canonical completion, the Online Learning workflow, synchronized unambiguous fields, and reliable time", () => {
    for (const rule of [
      "status_ref.dashboard_classification='completed'",
      "status_ref.workflow_id='IEACHQK7K4BHMLHM'",
      "task.custom_fields_sync_state",
      "course_length_conflict",
      "course_style_conflict",
      "import_run.status='succeeded'",
      "import_run.timelog_descendant_strategy in ('folder_recursive','explicit_tree')",
      "import_run.failed_folder_request_count=0",
      "time_data.active_entry_count>0",
      "time_data.duplicate_source_count=0"
    ]) expect(migration).toContain(rule);

    for (const reason of [
      "project_deleted",
      "completion_status_unresolved",
      "wrong_workflow",
      "project_not_completed",
      "custom_fields_incomplete",
      "course_length_missing",
      "course_length_invalid",
      "course_length_ambiguous",
      "course_style_missing",
      "course_style_unrecognized",
      "course_style_ambiguous",
      "time_entry_data_incomplete"
    ]) expect(migration).toContain(`'${reason}'`);
  });

  it("partitions only eligible projects by exact duration and exact style, with no nearby fallback", () => {
    expect(migration).toContain("where evidence.eligibility_reason is null");
    expect(migration).toContain("group by eligible.length_minutes,eligible.normalized_course_style");
    expect(migration).toContain("partition by eligible.length_minutes,eligible.normalized_course_style");
    expect(migration).toContain("stats.length_minutes=target.length_minutes");
    expect(migration).toContain("stats.normalized_course_style=target.normalized_course_style");
    expect(migration).not.toMatch(/between\s+target\.length_minutes/i);
    expect(migration).not.toMatch(/coalesce\(target\.normalized_course_style/i);
  });

  it("keeps organization boundaries, deleted-entry exclusion, source-ID dedup evidence, and the 200-task bound", () => {
    expect(migration).toContain("task.organization_id=target_organization_id");
    expect(migration).toContain("entry.organization_id=target_organization_id and entry.task_id=task.id");
    expect(migration).toContain("not entry.is_deleted");
    expect(migration).toContain("count(distinct entry.wrike_id)");
    expect(migration).toContain("target_task_ids[1:200]");
    expect(migration).toContain("public.current_organization_id()");
  });

  it("calculates cohort mean, median, tie counts, and empirical midrank after eligibility", () => {
    expect(migration).toContain("percentile_cont(0.5) within group");
    expect(migration).toContain("rank() over(");
    expect(migration).toContain("cohort.cohort_size>=5");
    expect(migration).toContain("100.0 * (cohort.lower_count + 0.5 * cohort.tie_count)");
    expect(percentileRankFromCounts(3, 1, 5)).toBe(70);
    expect(percentileRank(20, [10, 20, 20, 30, 10_000])).toBe(40);
    expect(percentileRank(20, [10, 20, 30, 10_000])).toBeNull();
  });

  it("keeps the target exactly once and makes detailed membership admin-only", () => {
    expect(migration).toContain("select distinct requested_id as task_id");
    expect(migration).toContain("left join ranked rank_counts on rank_counts.task_id=target.task_id");
    expect(migration).toContain("admin_reporting_project_percentile_audit");
    expect(migration).toContain("viewer.role in ('super_admin','admin')");
    expect(migration).toContain("Administrator access is required for percentile cohort audits.");
    expect(migration).toContain("'includedMembers'");
    expect(migration).toContain("'excludedCandidates'");
    expect(migration).toContain("'exclusionReason'");
  });

  it("provides specific user-facing unavailable reasons", () => {
    expect(projectBenchmarkUnavailableMessage("project_not_completed")).toBe("Project is not completed.");
    expect(projectBenchmarkUnavailableMessage("course_length_missing")).toBe("Course Length is missing.");
    expect(projectBenchmarkUnavailableMessage("course_length_ambiguous")).toBe("Course Length is ambiguous.");
    expect(projectBenchmarkUnavailableMessage("course_style_missing")).toBe("Course Style is missing.");
    expect(projectBenchmarkUnavailableMessage("course_style_ambiguous")).toBe("Course Style is ambiguous.");
    expect(projectBenchmarkUnavailableMessage("time_entry_data_incomplete")).toBe("Time-entry data is incomplete.");
    expect(projectBenchmarkUnavailableMessage("not_enough_completed_comparable_courses"))
      .toBe("Not enough completed comparable courses.");
  });
});
