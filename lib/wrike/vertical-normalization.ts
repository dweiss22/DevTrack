export const APPROVED_VERTICALS = ["P1A", "C1A", "D1A", "FR1A", "EMS1", "LGU", "Lexipol", "Wellness"] as const;

export type ApprovedVertical = typeof APPROVED_VERTICALS[number];
export type VerticalReportingCategory = ApprovedVertical | "Cross Vertical" | "Unresolved Vertical";
export type VerticalState = "resolved" | "cross_vertical" | "missing" | "unrecognized" | "synchronization_incomplete";
export const VERTICAL_REPORTING_FILTER_OPTIONS = [...APPROVED_VERTICALS, "Cross Vertical"] as const;
export const VERTICAL_STATE_FILTER_OPTIONS = ["resolved", "cross_vertical", "missing", "unrecognized", "synchronization_incomplete"] as const;

export type NormalizedVerticalResult = {
  originalValue: unknown;
  normalizedVerticals: ApprovedVertical[];
  reportingCategory: VerticalReportingCategory;
  isCrossVertical: boolean;
  hasUnresolvedVertical: boolean;
  rejectedTokens: string[];
  verticalState: Exclude<VerticalState, "synchronization_incomplete">;
  crossVerticalTokens: string[];
};

const VERTICAL_ALIASES: Readonly<Record<string, ApprovedVertical>> = {
  P1A: "P1A",
  C1A: "C1A",
  D1A: "D1A",
  FR1A: "FR1A",
  EMS1: "EMS1",
  EMS1A: "EMS1",
  LGU: "LGU",
  LEXIPOL: "Lexipol",
  WELLNESS: "Wellness"
};

const CROSS_VERTICAL_ALIASES = new Set(["GENERAL", "CROSS VERTICAL", "CROSS-VERTICAL", "ALL VERTICALS"]);

function cleanToken(value: string) {
  let token = value.trim().replace(/\\(["'])/g, "$1");
  while (/^[\[\]"'\\]|[\[\]"'\\]$/.test(token)) token = token.replace(/^[\[\]"'\\]+|[\[\]"'\\]+$/g, "").trim();
  return token.replace(/\s+/g, " ");
}

function tokensFromValue(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(tokensFromValue);
  if (typeof value !== "string") return [String(value)];

  const trimmed = value.trim();
  if (!trimmed) return [];
  const unescaped = trimmed.replace(/\\"/g, '"').replace(/\\'/g, "'");
  if (unescaped.startsWith("[") && unescaped.endsWith("]")) {
    try {
      const parsed = JSON.parse(unescaped);
      if (Array.isArray(parsed)) return parsed.flatMap(tokensFromValue);
    } catch {
      // Malformed serialized arrays are handled by the delimiter parser below.
    }
  }
  return unescaped.split(/[,;|]/).map(cleanToken).filter(Boolean);
}

export function normalizeVerticalValue(value: unknown): NormalizedVerticalResult {
  const approved = new Set<ApprovedVertical>();
  const rejectedTokens: string[] = [];
  const rejectedKeys = new Set<string>();
  let semanticCrossVertical = false;
  const crossVerticalTokens: string[] = [];

  for (const token of tokensFromValue(value)) {
    const cleaned = cleanToken(token);
    if (!cleaned) continue;
    const aliasKey = cleaned.toLocaleUpperCase();
    if (CROSS_VERTICAL_ALIASES.has(aliasKey)) {
      semanticCrossVertical = true;
      if (!crossVerticalTokens.some((value) => value.toLocaleUpperCase() === aliasKey)) crossVerticalTokens.push(cleaned);
      continue;
    }
    const normalized = VERTICAL_ALIASES[aliasKey];
    if (normalized) approved.add(normalized);
    else {
      const key = cleaned.toLocaleLowerCase();
      if (!rejectedKeys.has(key)) {
        rejectedKeys.add(key);
        rejectedTokens.push(cleaned);
      }
    }
  }

  const normalizedVerticals = semanticCrossVertical ? [...APPROVED_VERTICALS] : APPROVED_VERTICALS.filter((vertical) => approved.has(vertical));
  const isCrossVertical = semanticCrossVertical || normalizedVerticals.length > 1;
  const reportingCategory: VerticalReportingCategory = isCrossVertical
    ? "Cross Vertical"
    : normalizedVerticals[0] ?? "Unresolved Vertical";
  const verticalState = rejectedTokens.length
    ? "unrecognized"
    : normalizedVerticals.length === 0
      ? "missing"
      : isCrossVertical
        ? "cross_vertical"
        : "resolved";
  return {
    originalValue: value,
    normalizedVerticals,
    reportingCategory,
    isCrossVertical,
    hasUnresolvedVertical: normalizedVerticals.length === 0 || rejectedTokens.length > 0,
    rejectedTokens,
    verticalState,
    crossVerticalTokens
  };
}

export function verticalStateLabel(state: VerticalState) {
  switch (state) {
    case "cross_vertical": return "Cross-Vertical";
    case "missing": return "Vertical not assigned";
    case "unrecognized": return "Vertical value needs review";
    case "synchronization_incomplete": return "Vertical data not fully synchronized";
    default: return "Resolved";
  }
}
