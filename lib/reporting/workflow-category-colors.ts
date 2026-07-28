export const WORKFLOW_CATEGORY_PALETTE = [
  "#145b9e",
  "#0c8f78",
  "#7c3aed",
  "#c25b12",
  "#b83280",
  "#527a20",
  "#087e8b",
] as const;

export const UNCATEGORIZED_WORKFLOW_COLOR = "#64748b";

export function workflowCategoryColor(category: string) {
  const normalized = normalizeCategory(category);
  if (!normalized || normalized === "uncategorized") return UNCATEGORIZED_WORKFLOW_COLOR;
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return WORKFLOW_CATEGORY_PALETTE[(hash >>> 0) % WORKFLOW_CATEGORY_PALETTE.length];
}

export function compactWorkflowCategoryLabel(category: string, maximumLength = 28) {
  const label = category.trim().replace(/\s+/g, " ") || "Uncategorized";
  return label.length <= maximumLength ? label : `${label.slice(0, maximumLength - 1).trimEnd()}…`;
}

function normalizeCategory(category: string) {
  return category.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
