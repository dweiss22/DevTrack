import Link from "next/link";
import { filtersToQuery, type ReportingFilters } from "@/lib/reporting/filters";

export function Pagination({ filters, total, returnTo }: { filters: ReportingFilters; total: number; returnTo?: string }) {
  const pages = Math.max(1, Math.ceil(total / filters.pageSize)); if (pages <= 1) return null;
  const href = (page: number) => {
    const query = new URLSearchParams(filtersToQuery({ ...filters, page }));
    if (returnTo) query.set("returnTo", returnTo);
    return `?${query.toString()}`;
  };
  return <nav className="pagination" aria-label="Report pages"><span>Page {filters.page} of {pages} · {total} records</span><div>{filters.page > 1 && <Link className="button secondary" href={href(filters.page - 1)}>Previous</Link>}{filters.page < pages && <Link className="button secondary" href={href(filters.page + 1)}>Next</Link>}</div></nav>;
}
