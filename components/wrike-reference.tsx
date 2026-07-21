import React from "react";
import { CircleHelp } from "lucide-react";
import { UNRESOLVED_REFERENCE_MESSAGES, type WrikeReferenceType } from "@/lib/wrike/reference-resolution";

export function UnresolvedReferenceLabel({ id, type, className = "", label, showId = true }: { id: string; type: WrikeReferenceType; className?: string; label?: string; showId?: boolean }) {
  const explanation = UNRESOLVED_REFERENCE_MESSAGES[type];
  const accessibleLabel = label
    ? `${label}.${showId ? ` Wrike ID ${id}.` : ""} ${explanation}`
    : `${id}. ${explanation}`;
  return <span className={`unresolved-reference ${className}`.trim()} tabIndex={0} aria-label={accessibleLabel}>
    {label ?? <code>{id}</code>}<CircleHelp size={14} aria-hidden="true" />
    <span className="unresolved-tooltip" role="tooltip">{explanation}{showId && <> Wrike ID: {id}</>}</span>
  </span>;
}

export function StatusBadge({ name, id, color, resolved = true }: { name: string; id?: string | null; color?: string | null; resolved?: boolean }) {
  if (!resolved && id) return <span className="status-badge unresolved"><UnresolvedReferenceLabel id={id} type="custom_status" /></span>;
  return <span className="status-badge"><span className="status-color" style={{ backgroundColor: color ?? "var(--muted)" }} aria-hidden="true" />{name}</span>;
}
