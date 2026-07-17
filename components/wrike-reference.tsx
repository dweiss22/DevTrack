import React from "react";
import { CircleHelp } from "lucide-react";
import { UNRESOLVED_REFERENCE_MESSAGES, type WrikeReferenceType } from "@/lib/wrike/reference-resolution";

export function UnresolvedReferenceLabel({ id, type, className = "" }: { id: string; type: WrikeReferenceType; className?: string }) {
  const explanation = UNRESOLVED_REFERENCE_MESSAGES[type];
  return <span className={`unresolved-reference ${className}`.trim()} tabIndex={0} aria-label={`${id}. ${explanation}`}>
    <code>{id}</code><CircleHelp size={14} aria-hidden="true" />
    <span className="unresolved-tooltip" role="tooltip">{explanation}</span>
  </span>;
}

export function StatusBadge({ name, id, color, resolved = true }: { name: string; id?: string | null; color?: string | null; resolved?: boolean }) {
  if (!resolved && id) return <span className="status-badge unresolved"><UnresolvedReferenceLabel id={id} type="custom_status" /></span>;
  return <span className="status-badge"><span className="status-color" style={{ backgroundColor: color ?? "var(--muted)" }} aria-hidden="true" />{name}</span>;
}
