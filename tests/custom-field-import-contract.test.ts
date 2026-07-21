import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const importer = fs.readFileSync(path.join(process.cwd(), "lib/wrike/folder-task-import.ts"), "utf8");
const repair = fs.readFileSync(path.join(process.cwd(), "lib/wrike/vertical-repair.ts"), "utf8");

describe("custom-field import persistence contract", () => {
  it("replaces readable and normalized relationships only for authoritative payloads", () => {
    expect(importer).toContain("resolutionByTaskId.get(task.id)?.authoritative");
    expect(importer).toMatch(/authoritativeTaskIds[\s\S]*wrike_task_custom_field_values"\)\.delete/);
    expect(importer).toMatch(/persistNormalizedTaskCustomFields[\s\S]*tasks\.filter\(\(task\) => resolutionByTaskId\.get\(task\.id\)\?\.authoritative\)/);
  });

  it("stores bounded verification provenance and hydrates in supported batches", () => {
    expect(importer).toContain("detailVerificationFingerprint");
    expect(importer).toContain("CUSTOM_FIELD_DETAIL_VERIFICATION_VERSION");
    expect(importer).toContain("offset += 100");
    expect(importer).toContain("taskDetailsPath(batch)");
  });

  it("keeps folder mappings, manual mappings, and time entries outside repair replacement", () => {
    expect(repair).toContain("loadCustomFieldManualMappings");
    expect(repair).not.toMatch(/from\("wrike_folder_task_imports"\)\.delete/);
    expect(repair).not.toMatch(/from\("wrike_time_entries"\)\.delete/);
    expect(repair).not.toMatch(/from\("wrike_manual_mappings"\)\.delete/);
  });
});
