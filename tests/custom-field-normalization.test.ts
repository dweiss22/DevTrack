import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { customFieldDisplayValues, mergeNormalizedCustomFields, normalizeWrikeCustomFieldTitle } from "@/lib/wrike/custom-field-normalization";
import { loadCustomFieldOptions } from "@/lib/reporting/options";
import { persistNormalizedTaskCustomFields } from "@/lib/wrike/custom-field-persistence";

const field = (id: string, title: string, value: unknown) => ({ id, title, type: "DropDown", rawValue: value, displayValue: value, resolved: true });

describe("Wrike custom-field normalization", () => {
  it("removes legacy wrappers case-insensitively and collapses whitespace", () => {
    expect(normalizeWrikeCustomFieldTitle("[LCT] Authoring Tool (M)")).toEqual({ normalizedTitle: "Authoring Tool", normalizedKey: "authoring tool", sourceDesignation: "M" });
    expect(normalizeWrikeCustomFieldTitle("[LCT] Authoring Tool (L)")).toEqual({ normalizedTitle: "Authoring Tool", normalizedKey: "authoring tool", sourceDesignation: "L" });
    expect(normalizeWrikeCustomFieldTitle("[LCT] Authoring Tool").normalizedTitle).toBe("Authoring Tool");
    expect(normalizeWrikeCustomFieldTitle("  [lct]   Course   Type   (m) ")).toEqual({ normalizedTitle: "Course Type", normalizedKey: "course type", sourceDesignation: "M" });
    expect(normalizeWrikeCustomFieldTitle("[LCT] Reporting (M)").normalizedKey).toBe("reporting");
    expect(normalizeWrikeCustomFieldTitle("[LCT] Reporting (L)").normalizedKey).toBe("reporting");
  });

  it("applies only the centralized conservative aliases", () => {
    expect(normalizeWrikeCustomFieldTitle("[LCT] Authoring Tool Used (L)").normalizedTitle).toBe("Authoring Tool");
    expect(normalizeWrikeCustomFieldTitle("Course Development Type").normalizedTitle).toBe("Course Type");
    expect(normalizeWrikeCustomFieldTitle("Primary Product Area").normalizedTitle).toBe("Product Area");
    expect(normalizeWrikeCustomFieldTitle("Delivery Method").normalizedTitle).toBe("Delivery Method");
  });

  it("groups sources, ignores empty values, and merges one or duplicate values", () => {
    const single = mergeNormalizedCustomFields([field("M1", "[LCT] Authoring Tool (M)", "Storyline"), field("L1", "[LCT] Authoring Tool (L)", " ")])[0];
    expect(single).toMatchObject({ normalizedTitle: "Authoring Tool", displayValues: ["Storyline"], sourceFieldIds: ["M1", "L1"], sourceTitles: ["[LCT] Authoring Tool (M)", "[LCT] Authoring Tool (L)"], conflict: false });
    expect(single.sources[0].rawValue).toBe("Storyline");
    const duplicate = mergeNormalizedCustomFields([field("M1", "[LCT] Authoring Tool (M)", ["Rise", "Storyline"]), field("L1", "[LCT] Authoring Tool (L)", ["Storyline", "Rise"])])[0];
    expect(duplicate.displayValues).toEqual(["Rise", "Storyline"]);
    expect(duplicate.conflict).toBe(false);
    expect(customFieldDisplayValues([null, "", " Rise ", "Rise"])).toEqual(["Rise"]);
  });

  it("preserves and flags conflicting source values without choosing a winner", () => {
    const merged = mergeNormalizedCustomFields([field("M1", "[LCT] Authoring Tool (M)", "Storyline"), field("L1", "[LCT] Authoring Tool (L)", "Rise")])[0];
    expect(merged).toMatchObject({ displayValues: ["Storyline", "Rise"], conflict: true });
    expect(merged.conflictMetadata?.distinctValueSets).toEqual([{ wrikeFieldId: "M1", values: ["Storyline"] }, { wrikeFieldId: "L1", values: ["Rise"] }]);
  });

  it("persists and logs conflicts without failing reconciliation", async () => {
    const fields = mergeNormalizedCustomFields([field("M1", "[LCT] Authoring Tool (M)", "Storyline"), field("L1", "[LCT] Authoring Tool (L)", "Rise")]);
    const from = vi.fn(() => ({
      delete: () => ({ in: async () => ({ error: null }) }),
      upsert: async () => ({ error: null })
    }));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await persistNormalizedTaskCustomFields({ from } as never, new Map([["authoring tool", "F1"]]), [{ taskId: "T1", taskWrikeId: "WT1", fields }], "2026-07-17T00:00:00Z");
    warning.mockRestore();
    expect(result).toMatchObject({ valueCount: 1, conflictCount: 1 });
    expect(from).toHaveBeenCalledWith("wrike_task_normalized_custom_field_values");
  });

  it("builds dynamic filter choices only from observed reporting rows", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [
      { normalized_field_id: "F1", normalized_title: "Authoring Tool", value: "Storyline" },
      { normalized_field_id: "F1", normalized_title: "Authoring Tool", value: "Rise" },
      { normalized_field_id: "F1", normalized_title: "Authoring Tool", value: "Rise" }
    ], error: null });
    const result = await loadCustomFieldOptions({ rpc } as never);
    expect(rpc).toHaveBeenCalledWith("reporting_custom_field_options");
    expect(result).toEqual([{ id: "F1", name: "Authoring Tool", values: ["Rise", "Storyline"] }]);
    expect(JSON.stringify(result)).not.toContain("Captivate");
  });

  it("documents normalization, conflicts, raw-ID preservation, and dynamic choices", () => {
    const inventory = fs.readFileSync(path.join(process.cwd(), "docs/wrike-api-inventory.md"), "utf8");
    expect(inventory).toContain("## Custom Field Name Normalization");
    expect(inventory).toContain("[LCT] Authoring Tool (M) → Authoring Tool");
    expect(inventory).toContain("marked as conflicted");
    expect(inventory).toContain("original Wrike field ID");
    expect(inventory).toContain("actually present on tasks visible");
  });
});
