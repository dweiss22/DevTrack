import React from "react";

export type ProjectsMultiSelectOption = { value: string; label: string };

export function ProjectsMultiSelect({ label, name, options, selected, allLabel, emptyLabel, disabled = false }: {
  label: string;
  name: string;
  options: readonly ProjectsMultiSelectOption[];
  selected: readonly string[];
  allLabel: string;
  emptyLabel: string;
  disabled?: boolean;
}) {
  const summary = selected.length ? `${selected.length} selected` : allLabel;
  return <div className="projects-multi-select">
    <span className="projects-multi-label">{label}</span>
    <details>
      <summary aria-label={`${label} filter. ${summary}`}>{summary}</summary>
      <fieldset disabled={disabled}>
        <legend className="sr-only">Select one or more {label} values</legend>
        {options.map((option) => <label key={option.value}>
          <input type="checkbox" name={name} value={option.value} defaultChecked={selected.includes(option.value)} />
          <span>{option.label}</span>
        </label>)}
        {!options.length && <p>{emptyLabel}</p>}
      </fieldset>
    </details>
  </div>;
}
