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
    title: "SME identity not configured",
    message: "Ask an administrator to link your DevTrack account to your SME identity in User Management. A Wrike account is not required for this link.",
  },
  identity_unavailable: {
    title: "SME identity unavailable",
    message: "The selected SME identity is missing or its name matches more than one person in this organization's project data. Ask an administrator to resolve it.",
  },
  not_assigned: {
    title: "Project assignment unavailable",
    message: "This project's SME field does not list this SME's name. Ask an administrator to confirm the SME field on this project in Wrike.",
  },
  assignment_conflict: {
    title: "SME field needs administrative review",
    message: "This SME's name appears on the project, but the project's SME field contains conflicting or ambiguous values, so it cannot be shown here yet. Ask an administrator to correct the SME field on this project in Wrike.",
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
