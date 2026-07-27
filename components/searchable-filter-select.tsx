"use client";

import React, { useId, useState } from "react";

export type SearchableFilterSelectOption = { value: string; label: string };

export function filterSearchableSelectOptions(options: readonly SearchableFilterSelectOption[], query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  return normalized
    ? options.filter((option) => option.label.toLocaleLowerCase().includes(normalized))
    : [...options];
}

export function SearchableFilterSelect({
  label,
  name,
  options,
  defaultValue = "",
  allLabel,
}: {
  label: string;
  name: string;
  options: readonly SearchableFilterSelectOption[];
  defaultValue?: string;
  allLabel: string;
}) {
  const searchId = useId();
  const selectId = useId();
  const [query, setQuery] = useState("");
  const filtered = filterSearchableSelectOptions(options, query);
  const visible = defaultValue && !filtered.some((option) => option.value === defaultValue)
    ? [...options.filter((option) => option.value === defaultValue), ...filtered]
    : filtered;
  return <div className="searchable-filter-select">
    <label htmlFor={searchId}>Search {label}
      <input id={searchId} type="search" value={query} autoComplete="off"
        placeholder={`Search ${label.toLocaleLowerCase()}`}
        onChange={(event) => setQuery(event.target.value)} />
    </label>
    <label htmlFor={selectId}>{label}
      <select id={selectId} name={name} defaultValue={defaultValue}>
        <option value="">{allLabel}</option>
        {visible.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
      </select>
    </label>
    {query && !filtered.length && <p className="muted" role="status">No matching options.</p>}
  </div>;
}
