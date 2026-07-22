import { describe, expect, it } from "vitest";
import { APPROVED_VERTICALS, normalizeVerticalValue } from "@/lib/wrike/vertical-normalization";
import { mergeNormalizedCustomFields } from "@/lib/wrike/custom-field-normalization";

describe("controlled Vertical normalization", () => {
  it.each([
    ["P1A", ["P1A"]],
    [" ems1a ", ["EMS1"]],
    ['["D1A", "p1a"]', ["P1A", "D1A"]],
    ['[\\"FR1A\\"; \'Wellness\']', ["FR1A", "Wellness"]],
    [["Lexipol", "LGU", "lexipol"], ["LGU", "Lexipol"]],
    ["C1A|EMS1A, P1A", ["P1A", "C1A", "EMS1"]]
  ])("parses %j into controlled order", (input, expected) => {
    expect(normalizeVerticalValue(input).normalizedVerticals).toEqual(expected);
  });

  it("reports multiple approved values once as Cross Vertical", () => {
    expect(normalizeVerticalValue("Wellness; P1A")).toMatchObject({
      normalizedVerticals: ["P1A", "Wellness"], reportingCategory: "Cross Vertical", isCrossVertical: true, hasUnresolvedVertical: false
    });
  });

  it.each([
    [["EMS1", "EMS"], "EMS1"],
    [["FR1A", "Fire"], "FR1A"],
    [["C1A", "C"], "C1A"],
    [["P1A", "LE"], "P1A"]
  ])("treats verified legacy source labels in %j as aliases for %s", (input, expected) => {
    expect(normalizeVerticalValue(input)).toMatchObject({
      normalizedVerticals: [expected],
      reportingCategory: expected,
      verticalState: "resolved",
      hasUnresolvedVertical: false,
      rejectedTokens: []
    });
  });

  it.each(["General", " general ", "Cross Vertical", "cross-vertical", "ALL   VERTICALS"])("expands semantic cross-Vertical alias %j without changing the original value", (input) => {
    expect(normalizeVerticalValue(input)).toMatchObject({
      originalValue: input,
      normalizedVerticals: [...APPROVED_VERTICALS],
      reportingCategory: "Cross Vertical",
      verticalState: "cross_vertical",
      hasUnresolvedVertical: false
    });
  });

  it("treats equivalent cross-Vertical source fields as nonconflicting", () => {
    const [vertical] = mergeNormalizedCustomFields([
      { id: "V1", title: "Vertical (M)", type: "DropDown", rawValue: "General", displayValue: "General", resolved: true },
      { id: "V2", title: "Vertical (L)", type: "DropDown", rawValue: "All Verticals", displayValue: "All Verticals", resolved: true }
    ]);
    expect(vertical).toMatchObject({ conflict: false, displayValues: [...APPROVED_VERTICALS], verticalNormalization: { crossVerticalTokens: ["General", "All Verticals"] } });
  });

  it("retains rejected tokens while reporting mixed input under its approved value", () => {
    const result = normalizeVerticalValue("P1A, Unknown, unknown");
    expect(result).toMatchObject({ originalValue: "P1A, Unknown, unknown", normalizedVerticals: ["P1A"], reportingCategory: "P1A", verticalState: "unrecognized", hasUnresolvedVertical: true, rejectedTokens: ["Unknown"] });
  });

  it.each([null, undefined, "", "[]", "Unknown"])("marks %j unresolved", (input) => {
    expect(normalizeVerticalValue(input)).toMatchObject({ normalizedVerticals: [], reportingCategory: "Unresolved Vertical", verticalState: input === "Unknown" ? "unrecognized" : "missing", hasUnresolvedVertical: true });
  });

  it("keeps the controlled list stable and enriches only the normalized Vertical field", () => {
    expect(APPROVED_VERTICALS).toEqual(["P1A", "C1A", "D1A", "FR1A", "EMS1", "LGU", "Lexipol", "Wellness"]);
    const fields = mergeNormalizedCustomFields([
      { id: "V1", title: "Vertical", type: "DropDown", rawValue: "EMS1A, Bad", displayValue: "EMS1A, Bad", resolved: true },
      { id: "C1", title: "Course Type", type: "DropDown", rawValue: "EMS1A, Bad", displayValue: "EMS1A, Bad", resolved: true }
    ]);
    expect(fields.find((field) => field.normalizedKey === "vertical")).toMatchObject({ displayValues: ["EMS1"], verticalNormalization: { rejectedTokens: ["Bad"] } });
    expect(fields.find((field) => field.normalizedKey === "course type")).toMatchObject({ displayValues: ["EMS1A, Bad"], verticalNormalization: undefined });
  });
});
