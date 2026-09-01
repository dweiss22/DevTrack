import Link from "next/link";
import React from "react";
import { IdDashboardAnalyticsSection } from "@/components/id-dashboard-analytics";
import { IdDashboardProjectTable } from "@/components/id-dashboard-project-table";
import { SearchableFilterSelect } from "@/components/searchable-filter-select";
import {
  canonicalDashboardIdentities, dashboardIdentityLabel,
  type DashboardIdentity, type SurveySummary,
} from "@/lib/dashboards/domain";
import type { IdDashboardAnalytics } from "@/lib/dashboards/id-analytics";
import { sortDashboardProjectsNewestFirst } from "@/lib/dashboards/project-order";

export type IdDashboardRow = {
  task_id: string;
  title: string;
  status_name: string;
  status_classification: string;
  reviewed_wrike_user_id: string | null;
  sme_identity_id: string | null;
  reviewed_sme_name: string | null;
  reviewed_sme_email: string | null;
  reviewed_sme_application_user_id: string | null;
  sme_mapping_status: "mapped" | "unmapped" | null;
  sme_identity_status: "discovered" | "verified" | "resolved" | "ambiguous" | "unresolved" | "conflict" | "missing";
  sme_assignment_values: string[];
  vertical: string | null;
  course_style?: string | null;
  publication_date: string | null;
  publication_year: number | null;
  reporting_year: number | null;
  original_due_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  folder_context: string;
  updated_at_wrike: string | null;
  own_review: SurveySummary | null;
  colleague_reviews: SurveySummary[];
  finalized_draft?: { available: boolean; updatedAt?: string | null; updatedBy?: string | null };
};

export function IdDashboard({ identities, selected, rows, canSelect, canActAsAssignedId, mappingRequired, analytics = null, analyticsError = null }: {
  identities: DashboardIdentity[];
  selected: DashboardIdentity | null;
  rows: IdDashboardRow[];
  canSelect: boolean;
  canActAsAssignedId: boolean;
  mappingRequired: boolean;
  ownOperationalView?: boolean;
  analytics?: IdDashboardAnalytics | null;
  analyticsError?: string | null;
}) {
  const returnTo = selected?.wrike_user_id ? `/id-dashboard?id=${encodeURIComponent(selected.wrike_user_id)}` : "/id-dashboard";
  const canonicalIdentities = canonicalDashboardIdentities(identities);
  const selectableIdentities = canonicalIdentities.filter((identity) => identity.selectable && identity.wrike_user_id);
  const unresolvedIdentities = canonicalIdentities.filter((identity) => !identity.selectable);
  const orderedRows = sortDashboardProjectsNewestFirst(rows);
  return <>
    {canSelect && <section className="card sme-selector-card"><form method="get">
      <SearchableFilterSelect label="Instructional Designer" name="id"
        defaultValue={selected?.wrike_user_id ?? ""} allLabel="Select an ID"
        options={selectableIdentities.map((identity) => ({
          value: identity.wrike_user_id ?? "", label: dashboardIdentityLabel(identity),
        }))} />
      <button>View dashboard</button>
    </form>
      <IdentityResolutionWarnings identities={unresolvedIdentities} />
    </section>}
    {mappingRequired ? <p className="card notice warning" role="status">Your DevTrack account is not mapped to a verified Wrike identity. Ask an administrator to configure the mapping in User Management.</p>
      : !selected ? <p className="card empty">{selectableIdentities.length ? "Select a verified ID to view assigned work." : "No trusted ID assignments are available."}</p>
        : <>
          <IdDashboardAnalyticsSection key={selected.wrike_user_id} analytics={analytics} error={analyticsError} />
          <IdDashboardProjectTable rows={orderedRows} returnTo={returnTo} canActAsAssignedId={canActAsAssignedId} />
        </>}
  </>;
}

function IdentityResolutionWarnings({ identities }: { identities: DashboardIdentity[] }) {
  if (!identities.length) return null;
  return <details className="dashboard-identity-warnings">
    <summary>{identities.length} assignment value{identities.length === 1 ? "" : "s"} need identity resolution</summary>
    <p className="muted">These values do not uniquely match an active, verified Wrike identity and are not selectable users. Correct ambiguous ID/owner values in Wrike, then re-import; verified people remain listed once by their stable identity.</p>
    <ul>{identities.map((identity) => <li key={identity.identity_key}>{dashboardIdentityLabel(identity)}</li>)}</ul>
  </details>;
}
