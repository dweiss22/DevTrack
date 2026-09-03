import { SearchableFilterSelect } from "@/components/searchable-filter-select";
import { StatusBadge } from "@/components/wrike-reference";
import {
  canonicalDashboardIdentities, dashboardIdentityLabel, type DashboardIdentity,
} from "@/lib/dashboards/domain";
import { sortDashboardProjectsNewestFirst } from "@/lib/dashboards/project-order";

export type VideoDashboardRow = {
  task_id: string;
  title: string;
  status_name: string;
  status_classification: string;
  original_due_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  folder_context: string;
  updated_at_wrike: string | null;
  course_style: string | null;
  runtime: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" })
    .format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));
}

export function VideoDashboard({ identities, selected, rows, canSelect, mappingRequired }: {
  identities: DashboardIdentity[];
  selected: DashboardIdentity | null;
  rows: VideoDashboardRow[];
  canSelect: boolean;
  mappingRequired: boolean;
}) {
  const canonicalIdentities = canonicalDashboardIdentities(identities);
  const selectableIdentities = canonicalIdentities.filter((identity) => identity.selectable && identity.wrike_user_id);
  const orderedRows = sortDashboardProjectsNewestFirst(rows);
  return <>
    {canSelect && <section className="card sme-selector-card"><form method="get">
      <SearchableFilterSelect label="Videographer" name="videographer"
        defaultValue={selected?.wrike_user_id ?? ""} allLabel="Select a videographer"
        options={selectableIdentities.map((identity) => ({
          value: identity.wrike_user_id ?? "", label: dashboardIdentityLabel(identity),
        }))} />
      <button>View dashboard</button>
    </form></section>}
    {mappingRequired ? <p className="card notice warning" role="status">Your DevTrack account is not mapped to a verified Wrike identity. Ask an administrator to configure the mapping in User Management.</p>
      : !selected ? <p className="card empty">{selectableIdentities.length ? "Select a videographer to view assigned work." : "No trusted Designer assignments are available."}</p>
        : !orderedRows.length ? <p className="card empty">No Single Video projects are currently assigned to {selected.display_name}.</p>
          : <div className="table-wrap"><table className="projects-table"><thead><tr>
            <th>Project name</th><th>Status</th><th>Runtime</th><th>Original Due Date</th><th>Due Date</th><th>Completed Date</th><th>Folders</th>
          </tr></thead><tbody>
            {orderedRows.map((row) => <tr key={row.task_id}>
              <td data-label="Project name">{row.title}</td>
              <td data-label="Status"><StatusBadge name={row.status_name} /></td>
              <td data-label="Runtime">{row.runtime ?? "—"}</td>
              <td data-label="Original Due Date">{formatDate(row.original_due_date)}</td>
              <td data-label="Due Date">{formatDate(row.due_date)}</td>
              <td data-label="Completed Date">{formatDate(row.completed_at)}</td>
              <td data-label="Folders">{row.folder_context}</td>
            </tr>)}
          </tbody></table></div>}
  </>;
}
