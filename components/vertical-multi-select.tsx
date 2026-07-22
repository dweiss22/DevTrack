import React from "react";
import { ProjectsMultiSelect, type ProjectsMultiSelectOption } from "@/components/projects-multi-select";

export type VerticalMultiSelectOption = ProjectsMultiSelectOption;

export function VerticalMultiSelect({ options, selected, disabled = false }: { options: VerticalMultiSelectOption[]; selected: readonly string[]; disabled?: boolean }) {
  return <ProjectsMultiSelect label="Vertical" name="verticalSelections" options={options} selected={selected} allLabel="All Verticals" emptyLabel="No synchronized Vertical choices are available." disabled={disabled} />;
}
