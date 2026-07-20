import { describe, expect, it } from "vitest";
import { chooseTimelogDescendantStrategy, deduplicateByWrikeId, folderTasksPath, folderTimelogsPath, mapWithConcurrency, TASK_FIELDS, TASK_IMPORT_FOLDER_IDS, verifyTaskRequestContract } from "@/lib/wrike/folder-task-import";
import { OUT_OF_SCOPE_WRIKE_FOLDER_IDS, scopedWrikeFolderIds, SELECTED_WRIKE_FOLDERS, SELECTED_WRIKE_FOLDER_IDS } from "@/lib/wrike/selected-folders";
import { allocatedMinutes, entryMinutes, plannedMinutes, taskPath } from "@/lib/wrike/sync";

describe("Wrike synchronization contracts", () => {
  it("requests reporting fields, descendants, subtasks, and an incremental overlap boundary", () => {
    const path = taskPath({ id: "scope", label: "Courses", scope_type: "folder", source_ids: ["folder/1"] }, "2026-07-01T00:00:00.000Z");
    expect(path).toContain("/folders/folder%2F1/tasks?");
    expect(decodeURIComponent(path)).toContain('"responsibleIds"');
    expect(decodeURIComponent(path)).toContain("descendants=true");
    expect(decodeURIComponent(path)).toContain("subTasks=true");
    expect(decodeURIComponent(path)).toContain("updatedDate=");
  });
  it("uses exact task-id paths and normalizes effort and time to minutes", () => {
    expect(taskPath({ id: "scope", label: "List", scope_type: "list", source_ids: ["A", "B"] })).toMatch(/^\/tasks\/A,B\?/);
    expect(plannedMinutes({ id: "T", title: "Task", status: "Active", effortAllocation: { totalEffort: 125, allocatedEffort: 90 } })).toBe(125);
    expect(allocatedMinutes({ id: "T", title: "Task", status: "Active", effortAllocation: { totalEffort: 125, allocatedEffort: 90 } })).toBe(90);
    expect(entryMinutes({ id: "E", taskId: "T", trackedDate: "2026-07-01", hours: 1.25 })).toBe(75);
  });
  it("shares the exact 13 selected folder IDs and titles with task and timelog imports", () => {
    expect(TASK_IMPORT_FOLDER_IDS).toBe(SELECTED_WRIKE_FOLDER_IDS);
    expect(SELECTED_WRIKE_FOLDERS).toEqual([
      { id: "IEACHQK7I4UOEPFL", title: "Cordico [New]" },
      { id: "IEACHQK7I4PGHAIF", title: "Custody [Maint]" },
      { id: "IEACHQK7I4QUZOFS", title: "Custody [New]" },
      { id: "IEACHQK7I45QZU3G", title: "Dispatch [New]" },
      { id: "IEACHQK7I4PGHAD7", title: "EMS [Maint]" },
      { id: "IEACHQK7I4SCO46Z", title: "EMS [New]" },
      { id: "IEACHQK7I4PGHBAC", title: "Fire [Maint]" },
      { id: "IEACHQK7I4N7GGRM", title: "Fire [New]" },
      { id: "IEACHQK7I4PGHACI", title: "Law Enforcement [Maint]" },
      { id: "IEACHQK7I4N7GGQ4", title: "Law Enforcement [New]" },
      { id: "IEACHQK7I4PGG7Z2", title: "Local Gov [Maint]" },
      { id: "IEACHQK7I4SCPAAB", title: "Local Gov [New]" },
      { id: "IEACHQK7I4N7GGRB", title: "Non-Vertical Content Projects [Maint]" }
    ]);
    expect(TASK_IMPORT_FOLDER_IDS).toHaveLength(13);
    expect(new Set(TASK_IMPORT_FOLDER_IDS).size).toBe(13);
    for (const folderId of TASK_IMPORT_FOLDER_IDS) {
      const contract = verifyTaskRequestContract(folderId);
      expect(contract).toMatchObject({ valid: true, descendants: true, plainTextCustomFields: true, subTasks: true });
      expect(contract.fields).toEqual(TASK_FIELDS);
      expect(folderTimelogsPath(folderId)).toBe(`/folders/${folderId}/timelogs?plainText=true`);
    }
  });
  it("excludes known higher-level Wrike ancestors from reporting locations", () => {
    expect(OUT_OF_SCOPE_WRIKE_FOLDER_IDS).toEqual([
      "IEACHQK7I4PFONLA",
      "IEACHQK7I4PFONKX",
      "IEACHQK7I4PFONKR",
      "IEACHQK7I7777777",
    ]);
    expect(scopedWrikeFolderIds([SELECTED_WRIKE_FOLDER_IDS[0], ...OUT_OF_SCOPE_WRIKE_FOLDER_IDS])).toEqual([SELECTED_WRIKE_FOLDER_IDS[0]]);
  });
  it("rejects malformed task contracts before a request can be sent", () => {
    const path = folderTasksPath(TASK_IMPORT_FOLDER_IDS[0]);
    expect(() => verifyTaskRequestContract(TASK_IMPORT_FOLDER_IDS[0], path.replace("plainTextCustomFields=true", "plainTextCustomFields=false"))).toThrow(/plainTextCustomFields=true/);
    expect(() => verifyTaskRequestContract(TASK_IMPORT_FOLDER_IDS[0], path.replace(encodeURIComponent(JSON.stringify(TASK_FIELDS)), encodeURIComponent('["customFields"]')))).toThrow(/missing required fields/);
    expect(() => verifyTaskRequestContract(TASK_IMPORT_FOLDER_IDS[0], path.replace(`/folders/${TASK_IMPORT_FOLDER_IDS[0]}/`, "/folders/WRONG/"))).toThrow(/selected folder ID/);
  });
  it("uses recursive evidence once and otherwise keeps the conservative explicit-tree strategy", () => {
    expect(chooseTimelogDescendantStrategy(undefined, 2)).toBe("folder_recursive");
    expect(chooseTimelogDescendantStrategy(undefined, 0)).toBe("explicit_tree");
    expect(chooseTimelogDescendantStrategy("explicit_tree", 99)).toBe("explicit_tree");
    expect(folderTimelogsPath("CHILD", false)).toBe("/folders/CHILD/timelogs?plainText=true&descendants=false");
  });
  it("deduplicates records by Wrike ID and bounds folder-request concurrency to four", async () => {
    expect(deduplicateByWrikeId([{ id: "A", source: 1 }, { id: "A", source: 2 }, { id: "B", source: 3 }])).toEqual([{ id: "A", source: 2 }, { id: "B", source: 3 }]);
    let active = 0; let maximum = 0;
    const results = await mapWithConcurrency(Array.from({ length: 13 }, (_, index) => index), 4, async (value) => {
      active++; maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
      return value * 2;
    });
    expect(maximum).toBe(4);
    expect(results).toEqual(Array.from({ length: 13 }, (_, index) => index * 2));
  });
});
