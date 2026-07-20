import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TASK_FIELDS, folderTasksPath } from "@/lib/wrike/folder-task-import";
import { WRIKE_OAUTH_SCOPE, WRIKE_OAUTH_SCOPES } from "@/lib/wrike/oauth";
import { fetchSelectedWrikeUsers, fetchWrikeTimelogCategories, parseTimelogCategoryResponse, parseWrikeUserResponse, resolveResponsibleUsers, resolveTaskStatus, resolveTimelogCategory, selectConfiguredWorkflow, wrikeUserPath } from "@/lib/wrike/reference-data";
import type { WrikeClient } from "@/lib/wrike/client";
import { SELECTED_WRIKE_USERS } from "@/lib/wrike/selected-users";
import { SELECTED_WRIKE_WORKFLOW } from "@/lib/wrike/selected-workflow";
import { WRIKE_TASK_FIELDS } from "@/lib/wrike/task-fields";

describe("Wrike reference-data contracts", () => {
  it("uses the exact configured 13-person allowlist and one safe path per ID", () => {
    expect(SELECTED_WRIKE_USERS).toEqual([
      { wrikeUserId: "KUALR6DZ", expectedName: "Devin Weiss" },
      { wrikeUserId: "KUANTWID", expectedName: "Koço Budo" },
      { wrikeUserId: "KUAPO5G4", expectedName: "Greg Rogers" },
      { wrikeUserId: "KUAOGSL5", expectedName: "Natalie Nelson" },
      { wrikeUserId: "KUATPQK3", expectedName: "Melissa Maurath" },
      { wrikeUserId: "KUAFESPT", expectedName: "Jon Dorman" },
      { wrikeUserId: "KUAOG6C6", expectedName: "Katie Willis" },
      { wrikeUserId: "KUAMLCDM", expectedName: "Rachel Frost" },
      { wrikeUserId: "KUAE45X3", expectedName: "Meena Kishnani" },
      { wrikeUserId: "KUAKTTA2", expectedName: "Emlyn Storrs" },
      { wrikeUserId: "KUAQCO2V", expectedName: "Mallory Lozoya" },
      { wrikeUserId: "KUAQCQMG", expectedName: "Jeffrey Dino" },
      { wrikeUserId: "KUAG3N3I", expectedName: "Lawson Coke" }
    ]);
    expect(SELECTED_WRIKE_USERS.map((user) => wrikeUserPath(user.wrikeUserId))).toHaveLength(13);
    expect(() => wrikeUserPath("../../bad")).toThrow(/Invalid Wrike user ID/);
  });

  it("parses only the requested user and defensively parses category tokens", () => {
    expect(parseWrikeUserResponse({ data: [{ id: "OTHER" }, { id: "KUALR6DZ", firstName: "Devin", lastName: "Weiss" }] }, "KUALR6DZ").firstName).toBe("Devin");
    expect(() => parseWrikeUserResponse({ data: [{ id: "OTHER" }] }, "KUALR6DZ")).toThrow(/requested ID/);
    expect(parseTimelogCategoryResponse({ data: [{ id: "CAT", name: "Development", hidden: false, order: 1 }], nextPageToken: "next" })).toEqual({ data: [{ id: "CAT", name: "Development", hidden: false, order: 1 }], nextPageToken: "next" });
  });

  it("bounds selected-user requests to four and returns visible failures without rejecting the reference run", async () => {
    let active = 0; let maximum = 0;
    const failedId = SELECTED_WRIKE_USERS[4].wrikeUserId;
    const client = { request: vi.fn(async (requestPath: string) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      const requestedId = requestPath.split("/").at(-1)!;
      if (requestedId === failedId) throw new Error("reference unavailable");
      return { data: [{ id: requestedId, firstName: "Wrike", lastName: requestedId }] };
    }) } as unknown as WrikeClient;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await fetchSelectedWrikeUsers(client);
    warning.mockRestore();
    expect(maximum).toBe(4);
    expect(result.retrieved).toHaveLength(12);
    expect(result.failures).toMatchObject([{ operation: "user", wrikeId: failedId, message: "reference unavailable" }]);
  });

  it("follows optional category tokens defensively and deduplicates category IDs", async () => {
    const client = { request: vi.fn()
      .mockResolvedValueOnce({ data: [{ id: "CAT1", name: "First" }], nextPageToken: "page two" })
      .mockResolvedValueOnce({ data: [{ id: "CAT1", name: "Updated" }, { id: "CAT2", name: "Second" }] }) } as unknown as WrikeClient;
    const result = await fetchWrikeTimelogCategories(client);
    expect(result).toMatchObject({ requests: 2, paginationObserved: true, failed: false });
    expect(result.categories).toEqual([{ id: "CAT1", name: "Updated" }, { id: "CAT2", name: "Second" }]);
  });

  it("preserves responsible-user order and applies authoritative, configured, then raw fallbacks", () => {
    const resolved = resolveResponsibleUsers(["KUALR6DZ", "KUANTWID", "UNKNOWN1"], [{ wrike_id: "KUALR6DZ", display_name: "Authoritative Name", email: "a@example.com", avatar_url: null, synced_at: "2026-07-17T00:00:00Z" }]);
    expect(resolved.map((user) => user.fullName)).toEqual(["Authoritative Name", "Koço Budo", "UNKNOWN1"]);
    expect(resolved.map((user) => user.fallbackSource)).toEqual(["wrike", "configured", "raw_id"]);
  });

  it("selects only Online Learning and resolves status/category names with raw-ID fallbacks", () => {
    const workflow = selectConfiguredWorkflow({ data: [{ id: "OTHER", name: "Other" }, { id: SELECTED_WRIKE_WORKFLOW.wrikeWorkflowId, name: "Online Learning", customStatuses: [{ id: "STATUS1", name: "In Review" }] }] });
    expect(workflow.id).toBe("IEACHQK7K4BHMLHM");
    expect(() => selectConfiguredWorkflow({ data: [{ id: "OTHER", name: "Other" }] })).toThrow(/not present/);
    expect(resolveTaskStatus("STATUS1", "Active", [{ wrike_id: "STATUS1", title: "In Review" }]).name).toBe("In Review");
    expect(resolveTaskStatus("MISSING", "Active", []).name).toBe("MISSING");
    expect(resolveTimelogCategory("CAT1", [{ wrike_id: "CAT1", title: "Development" }])?.name).toBe("Development");
    expect(resolveTimelogCategory("CAT2", [])?.name).toBe("CAT2");
  });

  it("shares the complete task field list and records the expanded OAuth scopes", () => {
    expect(TASK_FIELDS).toBe(WRIKE_TASK_FIELDS);
    expect(TASK_FIELDS).toContain("responsibleIds");
    expect(TASK_FIELDS).toContain("customFields");
    expect(decodeURIComponent(folderTasksPath("IEACHQK7I4N7GGRM"))).toContain(JSON.stringify(WRIKE_TASK_FIELDS));
    expect(WRIKE_OAUTH_SCOPES).toEqual(["wsReadOnly", "amReadOnlyUser"]);
    expect(WRIKE_OAUTH_SCOPE).toBe("wsReadOnly,amReadOnlyUser");
  });

  it("documents both reference endpoints, every configured ID, responsibleIds, and workflow selection", () => {
    const inventory = fs.readFileSync(path.join(process.cwd(), "docs/wrike-api-inventory.md"), "utf8");
    const implementation = fs.readFileSync(path.join(process.cwd(), "lib/wrike/reference-data.ts"), "utf8");
    expect(inventory).toContain("GET /users/{userId}");
    expect(inventory).toContain("GET /timelog_categories");
    expect(inventory).toContain("GET /workflows");
    expect(inventory).toContain("## Workflow and Task Status Reference");
    expect(inventory).toContain("responsibleIds");
    for (const user of SELECTED_WRIKE_USERS) expect(inventory).toContain(user.wrikeUserId);
    expect(inventory).toContain(SELECTED_WRIKE_WORKFLOW.wrikeWorkflowId);
    expect(implementation).toContain('client.request<unknown>("/workflows")');
    expect(implementation).toMatch(/wrike_workflows[\s\S]*onConflict: "organization_id,wrike_id"/);
    expect(implementation).toMatch(/wrike_workflow_statuses[\s\S]*onConflict: "organization_id,wrike_id"/);
  });
});
