import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskCustomFieldList, TaskFolderList } from "@/components/task-metadata";
import { ReportFilters } from "@/components/report-filters";
import { normalizeVerticalValue } from "@/lib/wrike/vertical-normalization";
import type { NormalizedCustomFieldValue } from "@/lib/wrike/custom-field-normalization";

describe("task metadata display", () => {
  it("renders readable Wrike titles instead of resolved IDs", () => {
    const folderMarkup = renderToStaticMarkup(<TaskFolderList folders={[{ id: "IEACHQK7I47EB6XE", title: "2023 Courses", scope: "WsFolder", resolved: true }]} />);
    const fieldMarkup = renderToStaticMarkup(<TaskCustomFieldList fields={[{ normalizedKey: "authoring tool", normalizedTitle: "Authoring Tool", displayValues: ["Rise", "Storyline"], sourceFieldIds: ["M1", "L1"], sourceTitles: ["[LCT] Authoring Tool (M)", "[LCT] Authoring Tool (L)"], sources: [{ wrikeFieldId: "M1", originalTitle: "[LCT] Authoring Tool (M)", sourceDesignation: "M", rawValue: "Rise", displayValue: "Rise", displayValues: ["Rise"] }, { wrikeFieldId: "L1", originalTitle: "[LCT] Authoring Tool (L)", sourceDesignation: "L", rawValue: "Storyline", displayValue: "Storyline", displayValues: ["Storyline"] }], conflict: true, conflictMetadata: { distinctValueSets: [{ wrikeFieldId: "M1", values: ["Rise"] }, { wrikeFieldId: "L1", values: ["Storyline"] }] } }]} />);
    expect(folderMarkup).toContain("2023 Courses");
    expect(folderMarkup).not.toContain("IEACHQK7I47EB6XE");
    expect(fieldMarkup).toContain("Authoring Tool");
    expect(fieldMarkup).toContain("Rise");
    expect(fieldMarkup).toContain("Storyline");
    expect(fieldMarkup).toContain("Conflicting Wrike values");
  });
  it("renders one normalized custom-field select with observed values on task-only reports", () => {
    const markup = renderToStaticMarkup(<ReportFilters filters={{ sort: "updated", page: 1, pageSize: 50, customFields: { F1: "Storyline" } }} customFields={[{ id: "F1", name: "Authoring Tool", values: ["Rise", "Storyline"] }]} taskOnly />);
    expect(markup).toContain("Authoring Tool");
    expect(markup).toContain('name="cf_F1"');
    expect(markup).toContain("Storyline");
    expect(markup).not.toContain("[LCT] Authoring Tool");
  });
  it("labels retained Vertical values as previously synchronized and limits original rejected tokens to administrators", () => {
    const vertical: NormalizedCustomFieldValue = { normalizedKey: "vertical", normalizedTitle: "Vertical", displayValues: ["P1A"], sourceFieldIds: ["V1"], sourceTitles: ["Vertical"], sources: [{ wrikeFieldId: "V1", originalTitle: "Vertical", sourceDesignation: null, rawValue: "P1A, Secret token", displayValue: "P1A, Secret token", displayValues: ["P1A, Secret token"] }], conflict: false, conflictMetadata: null, verticalNormalization: normalizeVerticalValue("P1A, Secret token") };
    const member = renderToStaticMarkup(<TaskCustomFieldList fields={[vertical]} verticalState="synchronization_incomplete" />);
    const admin = renderToStaticMarkup(<TaskCustomFieldList fields={[vertical]} verticalState="synchronization_incomplete" showAdminDiagnostics />);
    expect(member).toContain("Previously synchronized value");
    expect(member).not.toContain("Secret token");
    expect(admin).toContain("Original unrecognized Vertical values");
    expect(admin).toContain("Secret token");
  });
});
