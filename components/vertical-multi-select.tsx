import React from "react";

export type VerticalMultiSelectOption = { value: string; label: string };

export function VerticalMultiSelect({ options, selected, disabled = false }: { options: VerticalMultiSelectOption[]; selected: readonly string[]; disabled?: boolean }) {
  return <div className="vertical-multi-select">
    <span className="vertical-multi-label">Vertical</span>
    <details>
      <summary aria-label={`Vertical filter. ${selected.length ? `${selected.length} selected` : "All Verticals"}`}>
        {selected.length ? `${selected.length} selected` : "All Verticals"}
      </summary>
      <fieldset disabled={disabled}>
        <legend className="sr-only">Select one or more Verticals</legend>
        {options.map((option) => <label key={option.value}>
          <input type="checkbox" name="verticalSelections" value={option.value} defaultChecked={selected.includes(option.value)} />
          <span>{option.label}</span>
        </label>)}
        {!options.length && <p>No synchronized Vertical choices are available.</p>}
      </fieldset>
    </details>
  </div>;
}
