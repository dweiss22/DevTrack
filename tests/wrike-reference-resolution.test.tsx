import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UnresolvedReferenceLabel, StatusBadge } from "@/components/wrike-reference";
import { mergeNormalizedCustomFields } from "@/lib/wrike/custom-field-normalization";
import { encounteredUserIds } from "@/lib/wrike/folder-task-import";
import { referenceLabel, resolveWrikeReferenceByPrecedence, resolvedWrikeReference, unresolvedWrikeReference } from "@/lib/wrike/reference-resolution";
import { automaticStatusClassification, parseWrikeSpacesResponse, parseWrikeWorkflowsResponse, resolveResponsibleUsers, shouldRefreshWrikeUser } from "@/lib/wrike/reference-data";

describe("central Wrike reference resolution", () => {
  it("returns a consistent resolved or fallback structure", () => {
    const resolved = resolvedWrikeReference("KUALR6DZ", { name: "Devin Weiss" }, { source: "manual_mapping", lastResolvedAt: "2026-07-17T00:00:00Z" });
    expect(referenceLabel(resolved, (value) => value.name)).toBe("Devin Weiss");
    expect(resolved).toMatchObject({ id: "KUALR6DZ", resolved: true, resolutionSource: "manual_mapping" });
    const unresolved = unresolvedWrikeReference<{ name: string }>("UNKNOWN1");
    expect(referenceLabel(unresolved, (value) => value.name)).toBe("UNKNOWN1");
    expect(unresolved).toMatchObject({ resolved: false, resolutionSource: "unresolved", value: null });
  });

  it("applies manual, synchronized, historical, configured, then raw-ID precedence", () => {
    const candidates = {
      manualMapping: { value: "Manual" },
      synchronized: { value: "Wrike" },
      historical: { value: "Historical" },
      configuredFallback: { value: "Configured" }
    };
    expect(resolveWrikeReferenceByPrecedence("FIELD001", candidates)).toMatchObject({ value: "Manual", resolutionSource: "manual_mapping" });
    expect(resolveWrikeReferenceByPrecedence("FIELD001", { ...candidates, manualMapping: null })).toMatchObject({ value: "Wrike", resolutionSource: "database" });
    expect(resolveWrikeReferenceByPrecedence("FIELD001", { historical: candidates.historical, configuredFallback: candidates.configuredFallback })).toMatchObject({ value: "Historical", resolutionSource: "historical" });
    expect(resolveWrikeReferenceByPrecedence("FIELD001", { configuredFallback: candidates.configuredFallback })).toMatchObject({ value: "Configured", resolutionSource: "configured_fallback" });
    expect(resolveWrikeReferenceByPrecedence<string>("FIELD001", {})).toMatchObject({ value: null, fallbackLabel: "FIELD001", resolutionSource: "unresolved" });
  });

  it("renders unresolved IDs with focusable, screen-reader, hover-tooltip semantics", () => {
    const markup = renderToStaticMarkup(<UnresolvedReferenceLabel id="UNKNOWN1" type="user" />);
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('role="tooltip"');
    expect(markup).toContain("This Wrike user could not be identified");
    expect(markup).toContain('aria-label="UNKNOWN1.');
    expect(renderToStaticMarkup(<StatusBadge name="UNKNOWN1" id="UNKNOWN1" resolved={false} />)).toContain("unresolved-reference");
  });

  it("preserves historical people and refreshes only missing, unresolved, or older-than-24-hour records", () => {
    const historical = resolveResponsibleUsers(["KUALR6DZ"], [{ wrike_id: "KUALR6DZ", display_name: "Historical Name", email: null, avatar_url: null, synced_at: "2026-07-16T00:00:00Z", is_active: false, is_unresolved: false }])[0];
    expect(historical).toMatchObject({ fullName: "Historical Name", resolved: true, fallbackSource: "historical" });
    const now = new Date("2026-07-17T12:00:00Z");
    expect(shouldRefreshWrikeUser(undefined, now)).toBe(true);
    expect(shouldRefreshWrikeUser({ is_unresolved: true, synced_at: now.toISOString() }, now)).toBe(true);
    expect(shouldRefreshWrikeUser({ is_unresolved: false, synced_at: "2026-07-17T00:01:00Z" }, now)).toBe(false);
    expect(shouldRefreshWrikeUser({ is_unresolved: false, synced_at: "2026-07-16T00:00:00Z" }, now)).toBe(true);
  });

  it("deduplicates encountered IDs across tasks, timelogs, projects, and Contacts custom fields", () => {
    const definitions = new Map([["CONTACTS", { id: "CONTACTS", title: "SMEs", type: "Contacts" } as never]]);
    const ids = encounteredUserIds(
      [{ id: "T", title: "Task", status: "Active", responsibleIds: ["KUALR6DZ"], authorIds: ["KUANTWID"], customFields: [{ id: "CONTACTS", value: ["KUALR6DZ", "KUAPO5G4"] }] }],
      [{ id: "E", taskId: "T", userId: "KUANTWID", trackedDate: "2026-07-17" }],
      [{ id: "F", title: "Folder", childIds: [], scope: "WsFolder", project: { ownerIds: ["KUAOGSL5"], authorId: "KUAPO5G4" } }],
      definitions
    );
    expect(ids).toEqual(["KUALR6DZ", "KUANTWID", "KUAPO5G4", "KUAOGSL5"]);
  });

  it("parses every workflow and defensive space pages and classifies statuses centrally", () => {
    expect(parseWrikeWorkflowsResponse({ data: [{ id: "WF1", name: "One" }, { id: "WF2", name: "Two", customStatuses: [] }] })).toHaveLength(2);
    expect(parseWrikeSpacesResponse({ data: [{ id: "SPACE001", title: "Learning" }], nextPageToken: "next" })).toEqual({ data: [{ id: "SPACE001", title: "Learning" }], nextPageToken: "next" });
    expect(automaticStatusClassification({ name: "Stalled - Waiting", group: "Active" })).toBe("active");
    expect(automaticStatusClassification({ name: "Any label", group: "Canceled" })).toBe("stalled_or_canceled");
    expect(automaticStatusClassification({ name: "Published", group: "Completed" })).toBe("completed");
    expect(automaticStatusClassification({ name: "In review", group: "Active" })).toBe("active");
    expect(automaticStatusClassification({ name: "Unknown", group: "Other" })).toBeNull();
  });

  it("applies manual logical-title overrides and ignores fields without losing raw sources", () => {
    const merged = mergeNormalizedCustomFields([
      { id: "UNKNOWN1", title: "UNKNOWN1", type: null, rawValue: "Captivate", displayValue: "Captivate", resolved: true, normalizedTitleOverride: "Authoring Tool" },
      { id: "IGNORE01", title: "Ignored", type: null, rawValue: "Secret", displayValue: "Secret", resolved: true, ignored: true }
    ]);
    expect(merged).toMatchObject([{ normalizedTitle: "Authoring Tool", displayValues: ["Captivate"], sourceFieldIds: ["UNKNOWN1"] }]);
  });

  it("keeps correction routes local and documents the new reference endpoints", () => {
    const mappingRoute = fs.readFileSync(path.join(process.cwd(), "app/api/admin/wrike/custom-field-mappings/route.ts"), "utf8");
    const inventory = fs.readFileSync(path.join(process.cwd(), "docs/wrike-api-inventory.md"), "utf8");
    expect(mappingRoute).toContain("rebuildNormalizedCustomFieldsFromRaw");
    expect(mappingRoute).toContain("claim_wrike_sync_lease");
    expect(mappingRoute).not.toContain("WrikeClient");
    expect(inventory).toContain("GET /workflows");
    expect(inventory).toContain("GET /spaces?withArchived=true");
    expect(inventory).toContain("wrike_unresolved_references");
  });
});
