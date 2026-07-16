import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskCustomFieldList, TaskFolderList } from "@/components/task-metadata";

describe("task metadata display", () => {
  it("renders readable Wrike titles instead of resolved IDs", () => {
    const folderMarkup = renderToStaticMarkup(<TaskFolderList folders={[{ id: "IEACHQK7I47EB6XE", title: "2023 Courses", scope: "WsFolder", resolved: true }]} />);
    const fieldMarkup = renderToStaticMarkup(<TaskCustomFieldList fields={[{ id: "IEACHQK7JUAHNWFH", title: "LCT Reporting", type: "DropDown", rawValue: "2025 Report", displayValue: "2025 Report", resolved: true }]} />);
    expect(folderMarkup).toContain("2023 Courses");
    expect(folderMarkup).not.toContain("IEACHQK7I47EB6XE");
    expect(fieldMarkup).toContain("LCT Reporting");
    expect(fieldMarkup).toContain("2025 Report");
    expect(fieldMarkup).not.toContain("IEACHQK7JUAHNWFH");
  });
});
