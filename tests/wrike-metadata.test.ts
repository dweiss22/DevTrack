import { describe, expect, it, vi } from "vitest";
import { fetchValidatedMetadata, validateBeforeReset } from "@/lib/wrike/folder-task-import";
import type { WrikeClient } from "@/lib/wrike/client";
import {
  buildCustomFieldDefinitionsById,
  buildCustomFieldsPath,
  buildFolderDefinitionsById,
  enrichTaskMetadata,
  isLctCustomField,
  parseCustomFieldsResponse,
  parseFolderTreeResponse
} from "@/lib/wrike/metadata";
import { actualCustomFieldsFixture, actualFolderTreeFixture } from "@/tests/fixtures/wrike-metadata";

describe("actual Wrike metadata structures", () => {
  it("validates and indexes the supplied folder tree without discarding project metadata", () => {
    const parsed = parseFolderTreeResponse({ ...actualFolderTreeFixture, futureProperty: true });
    const folders = buildFolderDefinitionsById(parsed.data);
    expect(folders.get("IEACHQK7I46YBWEN")?.title).toBe("02. Learning");
    expect(folders.get("IEACHQK7I46YBWEN")?.childIds).toContain("IEACHQK7I4PGHBAC");
    expect(folders.get("IEACHQK7I47EB6XE")?.title).toBe("2023 Courses");
    expect(folders.get("IEACHQK7I47EB6XE")?.project).toMatchObject({ ownerIds: [], status: "Custom", customStatusId: "IEACHQK7JMAAAAAA" });
    expect(parsed.futureProperty).toBe(true);
  });

  it("preserves real dropdown values and option colors", () => {
    const parsed = parseCustomFieldsResponse(actualCustomFieldsFixture);
    const fields = buildCustomFieldDefinitionsById(parsed.data);
    const definition = fields.get("IEACHQK7JUAHNWFH");
    expect(definition?.title).toBe("LCT Reporting");
    expect(definition?.settings?.values).toEqual(["2024 Report", "2025 Report"]);
    expect(definition?.settings?.options).toContainEqual({ value: "2025 Report", color: "Purple" });
    expect(definition && isLctCustomField(definition)).toBe(true);
  });

  it("resolves readable task metadata and preserves unresolved values", () => {
    const enriched = enrichTaskMetadata(
      { id: "T1", title: "Course", status: "Active", parentIds: ["IEACHQK7I47EB6XE"], customFields: [{ id: "IEACHQK7JUAHNWFH", value: "2025 Report" }, { id: "UNKNOWN", value: ["A", "B"] }] },
      buildFolderDefinitionsById(actualFolderTreeFixture.data),
      buildCustomFieldDefinitionsById(actualCustomFieldsFixture.data)
    );
    expect(enriched.folders[0]).toEqual({ id: "IEACHQK7I47EB6XE", title: "2023 Courses", scope: "WsFolder", resolved: true });
    expect(enriched.folderNames).toEqual(["2023 Courses"]);
    expect(enriched.customFields[0]).toEqual({ id: "IEACHQK7JUAHNWFH", title: "LCT Reporting", type: "DropDown", rawValue: "2025 Report", displayValue: "2025 Report", resolved: true });
    expect(enriched.customFields[1]).toEqual({ id: "UNKNOWN", title: "UNKNOWN", type: null, rawValue: ["A", "B"], displayValue: ["A", "B"], resolved: false });
    expect(enriched.customFieldsNormalized).toMatchObject([{ normalizedTitle: "LCT Reporting", displayValues: ["2025 Report"], sourceFieldIds: ["IEACHQK7JUAHNWFH"], conflict: false }]);
  });

  it("builds safely encoded custom-field searches with URLSearchParams", () => {
    expect(buildCustomFieldsPath("[LCT]")).toBe("/customfields?title=%5BLCT%5D");
    expect(buildCustomFieldsPath("[LCT] & Review")).toBe("/customfields?title=%5BLCT%5D+%26+Review");
    expect(buildCustomFieldsPath()).toBe("/customfields");
  });

  it("records both title probes and avoids the broad fallback when the expected field is found", async () => {
    const request = vi.fn(async (path: string) => path.includes("/folders/") ? actualFolderTreeFixture : actualCustomFieldsFixture);
    const result = await fetchValidatedMetadata({ request } as unknown as WrikeClient);
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/folders/IEACHQK7I46YBWEN/folders",
      "/customfields?title=%5BLCT%5D",
      "/customfields?title=LCT"
    ]);
    expect(result.diagnostics.unfilteredFallbackRequired).toBe(false);
    expect(result.diagnostics.matchedFieldTitles).toEqual(["LCT Reporting"]);
  });

  it("uses the unfiltered fallback when both title searches miss the expected definition", async () => {
    const request = vi.fn(async (path: string) => {
      if (path.includes("/folders/")) return actualFolderTreeFixture;
      return path === "/customfields" ? actualCustomFieldsFixture : { kind: "customfields", data: [] };
    });
    const result = await fetchValidatedMetadata({ request } as unknown as WrikeClient);
    expect(request).toHaveBeenLastCalledWith("/customfields");
    expect(result.diagnostics.unfilteredFallbackRequired).toBe(true);
    expect(result.matchedFields[0].id).toBe("IEACHQK7JUAHNWFH");
  });

  it("does not reset existing data when validation rejects", async () => {
    const reset = vi.fn(async () => undefined);
    await expect(validateBeforeReset(async () => { throw new Error("invalid folderTree"); }, reset)).rejects.toThrow("invalid folderTree");
    expect(reset).not.toHaveBeenCalled();
  });
});
