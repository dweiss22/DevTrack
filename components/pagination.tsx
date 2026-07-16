import Link from "next/link";
import { filtersToQuery, type ReportingFilters } from "@/lib/reporting/filters";

export function Pagination({ filters, total }: { filters: ReportingFilters; total: number }) {
  const pages = Math.max(1, Math.ceil(total / filters.pageSize)); if (pages <= 1) return null;
  return <nav className="pagination" aria-label="Report pages"><span>Page {filters.page} of {pages} · {total} records</span><div>{filters.page > 1 && <Link className="button secondary" href={`?${filtersToQuery({ ...filters, page: filters.page - 1 })}`}>Previous</Link>}{filters.page < pages && <Link className="button secondary" href={`?${filtersToQuery({ ...filters, page: filters.page + 1 })}`}>Next</Link>}</div></nav>;
}
