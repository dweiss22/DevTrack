export type ReportingFailure = {
  kind: "migration_required" | "timeout" | "permission_denied" | "query_failed";
  operation: string;
  title: string;
  message: string;
  diagnosticCode: string | null;
  technicalMessage: string | null;
};

export function reportingFailure(error: unknown, operation: string, migration?: string): ReportingFailure {
  const candidate = error && typeof error === "object" ? error as { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } : {};
  const diagnosticCode = candidate.code ?? null;
  const technicalMessage = [candidate.message, candidate.details, candidate.hint].filter(Boolean).join(" ") || (error instanceof Error ? error.message : null);
  const normalized = technicalMessage?.toLocaleLowerCase() ?? "";
  if (diagnosticCode === "PGRST202" || diagnosticCode === "42883" || normalized.includes("schema cache") || normalized.includes("could not find the function") || normalized.includes("does not exist")) {
    return {
      kind: "migration_required",
      operation,
      title: `${operation} requires a database migration`,
      message: migration
        ? `Apply Supabase migration ${migration}, reload the PostgREST schema cache, and retry.`
        : "Apply the pending Supabase migrations, reload the PostgREST schema cache, and retry.",
      diagnosticCode,
      technicalMessage
    };
  }
  if (diagnosticCode === "57014" || normalized.includes("statement timeout") || normalized.includes("timed out") || normalized.includes("timeout")) {
    return {
      kind: "timeout",
      operation,
      title: `${operation} timed out`,
      message: migration
        ? `The database canceled this query before it completed. Apply Supabase migration ${migration}, reload the PostgREST schema cache, and retry the optimized query.`
        : "The database canceled this query before it completed. Retry once, then review the query timing and Supabase statement-timeout logs if it repeats.",
      diagnosticCode,
      technicalMessage
    };
  }
  if (diagnosticCode === "42501" || normalized.includes("permission denied")) {
    return {
      kind: "permission_denied",
      operation,
      title: `${operation} was denied`,
      message: "Confirm that this account belongs to the correct organization and can execute the reporting query.",
      diagnosticCode,
      technicalMessage
    };
  }
  return {
    kind: "query_failed",
    operation,
    title: `${operation} failed`,
    message: "The synchronized reporting request did not complete. Retry the page and use the diagnostic details below when reviewing server logs.",
    diagnosticCode,
    technicalMessage
  };
}
