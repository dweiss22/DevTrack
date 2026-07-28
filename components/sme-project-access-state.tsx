import Link from "next/link";
import type { SmeProjectAccessState as AccessState } from "@/lib/smes/project-detail";

const content: Record<AccessState, { title: string; message: string }> = {
  not_found: {
    title: "Project not found",
    message: "This project does not exist or is no longer available in this organization.",
  },
  selection_required: {
    title: "Select an SME",
    message: "Choose a verified SME from SME Dashboard before opening this project.",
  },
  mapping_missing: {
    title: "Wrike identity not configured",
    message: "Ask an administrator to map your DevTrack account to your verified Wrike identity.",
  },
  identity_unavailable: {
    title: "Wrike identity unavailable",
    message: "The selected identity is missing, inactive, unresolved, or not verified in this organization.",
  },
  not_assigned: {
    title: "Project assignment unavailable",
    message: "The project does not explicitly assign this SME through the authoritative Wrike SME field.",
  },
  unavailable: {
    title: "Project unavailable",
    message: "This SME-safe project view is not available for the current account.",
  },
};

export function SmeProjectAccessState({ state, returnTo }: { state: AccessState; returnTo: string }) {
  const display = content[state];
  return <section className="card dashboard-query-error" role="status">
    <p className="eyebrow">SME PROJECT ACCESS</p>
    <h1>{display.title}</h1>
    <p>{display.message}</p>
    <Link className="button secondary" href={returnTo}>Return to SME Dashboard</Link>
  </section>;
}
