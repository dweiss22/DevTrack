import type { DashboardOverview } from "@/lib/reporting/dashboard";

export type DashboardNotice = {
  id: string;
  title: string;
  message: string;
  href?: string;
  actionLabel?: string;
};

export type DashboardNoticeSources = Record<string, DashboardNotice[]>;

type DashboardNoticeMetrics = Pick<DashboardOverview["metrics"], "unresolvedStatusProjects" | "customFieldConflictProjects" | "missingVerticalProjects" | "unrecognizedVerticalProjects" | "incompleteVerticalProjects">;

export function dashboardOverviewNotices(metrics: DashboardNoticeMetrics, verticalHrefs: Record<"missing" | "unrecognized" | "synchronization_incomplete", string>): DashboardNotice[] {
  const notices: DashboardNotice[] = [];

  if (metrics.unresolvedStatusProjects > 0) {
    const count = metrics.unresolvedStatusProjects;
    notices.push({
      id: "unresolved-statuses",
      title: "Unresolved project statuses",
      message: `${count} project${count === 1 ? " has" : "s have"} an unclassified or unresolved Wrike status.`,
    });
  }

  if (metrics.customFieldConflictProjects > 0) {
    const count = metrics.customFieldConflictProjects;
    notices.push({
      id: "custom-field-conflicts",
      title: "Conflicting custom fields",
      message: `${count} project${count === 1 ? " has" : "s have"} conflicting Dashboard custom-field sources.`,
    });
  }

  if (metrics.missingVerticalProjects > 0) {
    const count = metrics.missingVerticalProjects;
    notices.push({
      id: "missing-verticals",
      title: "Vertical not assigned",
      message: `${count} project${count === 1 ? " has" : "s have"} no Associated Vertical.`,
      href: verticalHrefs.missing,
      actionLabel: "Review affected projects",
    });
  }

  if (metrics.unrecognizedVerticalProjects > 0) {
    const count = metrics.unrecognizedVerticalProjects;
    notices.push({
      id: "unrecognized-verticals",
      title: "Vertical values need review",
      message: `${count} project${count === 1 ? " contains" : "s contain"} an unrecognized Associated Vertical value.`,
      href: verticalHrefs.unrecognized,
      actionLabel: "Review affected projects",
    });
  }

  if (metrics.incompleteVerticalProjects > 0) {
    const count = metrics.incompleteVerticalProjects;
    notices.push({
      id: "incomplete-vertical-sync",
      title: "Vertical data not fully synchronized",
      message: `${count} project${count === 1 ? " has" : "s have"} unverified custom-field data; retained values may be from an earlier synchronization.`,
      href: verticalHrefs.synchronization_incomplete,
      actionLabel: "Review affected projects",
    });
  }

  return notices;
}

export function dashboardTimeNotices(timeDataSynchronized: boolean): DashboardNotice[] {
  return timeDataSynchronized ? [] : [{
    id: "time-data-not-synchronized",
    title: "Time entries are not synchronized",
    message: "Time-entry synchronization has not completed, so averages are not shown as zero.",
  }];
}

export function replaceDashboardNoticeSource(sources: DashboardNoticeSources, source: string, notices: DashboardNotice[]): DashboardNoticeSources {
  if (sameNotices(sources[source], notices)) return sources;
  return { ...sources, [source]: notices };
}

export function removeDashboardNoticeSource(sources: DashboardNoticeSources, source: string): DashboardNoticeSources {
  if (!(source in sources)) return sources;
  const next = { ...sources };
  delete next[source];
  return next;
}

export function dashboardNoticesFromSources(sources: DashboardNoticeSources): DashboardNotice[] {
  return Object.values(sources).flat();
}

function sameNotices(current: DashboardNotice[] | undefined, next: DashboardNotice[]) {
  return current === next || (current?.length === next.length && current.every((notice, index) => {
    const candidate = next[index];
    return notice.id === candidate.id && notice.title === candidate.title && notice.message === candidate.message && notice.href === candidate.href && notice.actionLabel === candidate.actionLabel;
  }));
}
