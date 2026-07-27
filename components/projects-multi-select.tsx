"use client";

import React, { useId, useState } from "react";

export type ProjectsMultiSelectOption = { value: string; label: string };

export function filterProjectsMultiSelectOptions(options: readonly ProjectsMultiSelectOption[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return normalizedQuery
    ? options.filter((option) => option.label.toLocaleLowerCase().includes(normalizedQuery))
    : [...options];
}

export function ProjectsMultiSelect({ label, name, options, selected, allLabel, emptyLabel, disabled = false }: {
  label: string;
  name: string;
  options: readonly ProjectsMultiSelectOption[];
  selected: readonly string[];
  allLabel: string;
  emptyLabel: string;
  disabled?: boolean;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const visibleOptions = filterProjectsMultiSelectOptions(options, query);
  const visibleValues = new Set(visibleOptions.map((option) => option.value));
  const summary = selected.length ? `${selected.length} selected` : allLabel;
  return <div className="projects-multi-select">
    <span className="projects-multi-label">{label}</span>
    <details>
      <summary aria-label={`${label} filter. ${summary}`}>{summary}</summary>
      <fieldset disabled={disabled}>
        <legend className="sr-only">Select one or more {label} values</legend>
        {options.length > 0 && <label className="projects-filter-option-search" htmlFor={searchId}>
          <span className="sr-only">Search {label} filter values</span>
          <input id={searchId} type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${label.toLocaleLowerCase()}`} autoComplete="off" />
        </label>}
        {options.map((option) => <label key={option.value} hidden={!visibleValues.has(option.value)}>
          <input type="checkbox" name={name} value={option.value} defaultChecked={selected.includes(option.value)} />
          <span>{option.label}</span>
        </label>)}
        {!options.length && <p>{emptyLabel}</p>}
        {options.length > 0 && !visibleOptions.length && <p role="status">No {label.toLocaleLowerCase()} values match “{query}”.</p>}
      </fieldset>
    </details>
  </div>;
}
