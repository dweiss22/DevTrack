import type { createAdminClient } from "@/lib/supabase/admin";
import { logWrikeEvent, WrikeApiError, type WrikeClient } from "@/lib/wrike/client";
import { mapWithConcurrency } from "@/lib/wrike/concurrency";
import { SELECTED_WRIKE_USERS, SELECTED_WRIKE_USER_BY_ID, SELECTED_WRIKE_USER_IDS } from "@/lib/wrike/selected-users";
import { SELECTED_WRIKE_WORKFLOW } from "@/lib/wrike/selected-workflow";
import type { WrikeTimelogCategory, WrikeUser, WrikeWorkflow } from "@/lib/wrike/types";

type AdminClient = ReturnType<typeof createAdminClient>;
export type WrikeUserReferenceRow = {
  id?: string;
  wrike_id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
  synced_at?: string | null;
};
export type WrikeCategoryReferenceRow = { wrike_id: string; title: string };
export type WrikeStatusReferenceRow = { wrike_id: string; title: string };
export type ResolvedWrikeUser = {
  wrikeUserId: string;
  fullName: string;
  email: string | null;
  avatarUrl: string | null;
  resolved: boolean;
  fallbackSource: "wrike" | "configured" | "raw_id";
};
export type ResolvedTimelogCategory = { wrikeCategoryId: string; name: string; resolved: boolean };
export type ResolvedTaskStatus = { wrikeCustomStatusId: string | null; name: string; resolved: boolean };
export type ReferenceFailure = { operation: "workflow" | "user" | "timelog_categories" | "database"; wrikeId: string | null; status: number | null; message: string };
export type UserNameMismatch = { wrikeUserId: string; expectedName: string; returnedName: string };

export type ReferenceSyncDiagnostics = {
  workflow: { requests: number; selectedId: string; found: boolean; statusesReceived: number; statusesUpserted: number; failed: boolean; durationMs: number };
  users: {
    configured: number;
    requested: number;
    received: number;
    upserted: number;
    fallbackCreated: number;
    failed: number;
    failedIds: string[];
    nameMismatches: UserNameMismatch[];
    durationMs: number;
  };
  categories: { requests: number; received: number; upserted: number; paginationObserved: boolean; failed: boolean; durationMs: number };
  resolution?: {
    taskResponsibleIds: number;
    taskResponsibleResolved: number;
    taskResponsibleUnresolved: number;
    timelogUsersResolved: number;
    timelogUsersUnresolved: number;
    timelogCategoriesResolved: number;
    timelogCategoriesUnresolved: number;
    taskStatusesResolved: number;
    taskStatusesUnresolved: number;
  };
  failures: ReferenceFailure[];
};

export function wrikeUserPath(userId: string) {
  if (!/^[A-Z0-9]{8}$/.test(userId)) throw new Error(`Invalid Wrike user ID: ${userId}.`);
  return `/users/${encodeURIComponent(userId)}`;
}

export function parseWrikeUserResponse(value: unknown, requestedId: string): WrikeUser {
  if (!value || typeof value !== "object") throw new Error(`Wrike user ${requestedId} returned an invalid response.`);
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new Error(`Wrike user ${requestedId} response did not contain a data array.`);
  const user = data.find((item): item is WrikeUser => Boolean(item && typeof item === "object" && (item as { id?: unknown }).id === requestedId));
  if (!user) throw new Error(`Wrike user response did not contain requested ID ${requestedId}.`);
  return user;
}

export function parseTimelogCategoryResponse(value: unknown): { data: WrikeTimelogCategory[]; nextPageToken?: string } {
  if (!value || typeof value !== "object" || !Array.isArray((value as { data?: unknown }).data)) throw new Error("Wrike timelog categories returned an invalid response.");
  const response = value as { data: unknown[]; nextPageToken?: unknown };
  const data = response.data.filter((item): item is WrikeTimelogCategory => Boolean(item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"));
  if (data.length !== response.data.length) throw new Error("Wrike timelog categories contained an invalid record.");
  return { data, nextPageToken: typeof response.nextPageToken === "string" && response.nextPageToken ? response.nextPageToken : undefined };
}

export function selectConfiguredWorkflow(value: unknown): WrikeWorkflow {
  if (!value || typeof value !== "object" || !Array.isArray((value as { data?: unknown }).data)) throw new Error("Wrike workflows returned an invalid response.");
  const workflow = (value as { data: unknown[] }).data.find((item): item is WrikeWorkflow => Boolean(item && typeof item === "object" && (item as { id?: unknown }).id === SELECTED_WRIKE_WORKFLOW.wrikeWorkflowId));
  if (!workflow) throw new Error(`Wrike workflow ${SELECTED_WRIKE_WORKFLOW.wrikeWorkflowId} (${SELECTED_WRIKE_WORKFLOW.expectedName}) was not present in the account workflow response.`);
  if (workflow.customStatuses != null && !Array.isArray(workflow.customStatuses)) throw new Error(`Wrike workflow ${workflow.id} returned invalid custom statuses.`);
  return workflow;
}

const normalizedName = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
const fullName = (user: WrikeUser) => [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
const failureFor = (operation: ReferenceFailure["operation"], wrikeId: string | null, error: unknown): ReferenceFailure => ({
  operation,
  wrikeId,
  status: error instanceof WrikeApiError ? error.status : null,
  message: (error instanceof Error ? error.message : "Unknown Wrike reference-data error").slice(0, 500)
});

export function resolveResponsibleUsers(ids: readonly string[], users: readonly WrikeUserReferenceRow[]): ResolvedWrikeUser[] {
  const byId = new Map(users.map((user) => [user.wrike_id, user]));
  return ids.map((wrikeUserId) => {
    const user = byId.get(wrikeUserId);
    const configured = SELECTED_WRIKE_USER_BY_ID.get(wrikeUserId);
    if (user) return {
      wrikeUserId,
      fullName: user.display_name,
      email: user.email,
      avatarUrl: user.avatar_url,
      resolved: true,
      fallbackSource: user.synced_at ? "wrike" : "configured"
    };
    if (configured) return { wrikeUserId, fullName: configured.expectedName, email: null, avatarUrl: null, resolved: true, fallbackSource: "configured" };
    return { wrikeUserId, fullName: wrikeUserId, email: null, avatarUrl: null, resolved: false, fallbackSource: "raw_id" };
  });
}

export function resolveTimelogCategory(wrikeCategoryId: string | null | undefined, categories: readonly WrikeCategoryReferenceRow[]): ResolvedTimelogCategory | null {
  if (!wrikeCategoryId) return null;
  const category = categories.find((item) => item.wrike_id === wrikeCategoryId);
  return { wrikeCategoryId, name: category?.title ?? wrikeCategoryId, resolved: Boolean(category) };
}

export function resolveTaskStatus(customStatusId: string | null | undefined, baseStatus: string, statuses: readonly WrikeStatusReferenceRow[]): ResolvedTaskStatus {
  if (!customStatusId) return { wrikeCustomStatusId: null, name: baseStatus, resolved: true };
  const status = statuses.find((item) => item.wrike_id === customStatusId);
  return { wrikeCustomStatusId: customStatusId, name: status?.title ?? customStatusId, resolved: Boolean(status) };
}

export async function fetchSelectedWrikeUsers(client: WrikeClient) {
  const failures: ReferenceFailure[] = [];
  const fetched = await mapWithConcurrency(SELECTED_WRIKE_USERS, 4, async (configured) => {
    try {
      const response = await client.request<unknown>(wrikeUserPath(configured.wrikeUserId));
      return { configured, user: parseWrikeUserResponse(response, configured.wrikeUserId) };
    } catch (error) {
      const failure = failureFor("user", configured.wrikeUserId, error);
      failures.push(failure);
      logWrikeEvent("warn", "wrike_user_reference_failed", failure);
      return null;
    }
  });
  return { retrieved: fetched.filter((item): item is NonNullable<typeof item> => Boolean(item)), failures };
}

export async function fetchWrikeTimelogCategories(client: WrikeClient) {
  const failures: ReferenceFailure[] = [];
  const categories: WrikeTimelogCategory[] = [];
  const seenTokens = new Set<string>();
  let nextPageToken: string | undefined;
  let requests = 0;
  let paginationObserved = false;
  let failed = false;
  do {
    try {
      const path = nextPageToken ? `/timelog_categories?nextPageToken=${encodeURIComponent(nextPageToken)}` : "/timelog_categories";
      requests++;
      const page = parseTimelogCategoryResponse(await client.request<unknown>(path));
      categories.push(...page.data);
      nextPageToken = page.nextPageToken;
      if (nextPageToken) paginationObserved = true;
      if (nextPageToken && seenTokens.has(nextPageToken)) throw new Error("Wrike timelog category pagination repeated a token.");
      if (nextPageToken) seenTokens.add(nextPageToken);
    } catch (error) {
      const failure = failureFor("timelog_categories", null, error);
      failures.push(failure);
      logWrikeEvent("warn", "wrike_timelog_categories_failed", failure);
      failed = true;
      nextPageToken = undefined;
    }
  } while (nextPageToken && seenTokens.size < 100);
  return { categories: [...new Map(categories.map((category) => [category.id, category])).values()], requests, paginationObserved, failed, failures };
}

export async function syncWrikeReferenceData(db: AdminClient, organizationId: string, accountId: string | null, client: WrikeClient): Promise<{
  diagnostics: ReferenceSyncDiagnostics;
  userRows: WrikeUserReferenceRow[];
  categoryRows: WrikeCategoryReferenceRow[];
  statusRows: WrikeStatusReferenceRow[];
}> {
  const failures: ReferenceFailure[] = [];
  const nameMismatches: UserNameMismatch[] = [];
  const now = new Date().toISOString();
  let fallbackCreated = 0;

  let workflowFound = false;
  let workflowStatusesReceived = 0;
  let workflowStatusesUpserted = 0;
  let workflowFailed = false;
  const workflowStartedAt = Date.now();
  try {
    const workflow = selectConfiguredWorkflow(await client.request<unknown>("/workflows"));
    workflowFound = true;
    const statuses = workflow.customStatuses ?? [];
    workflowStatusesReceived = statuses.length;
    const { error: workflowError } = await db.from("wrike_workflows").upsert({
      organization_id: organizationId,
      wrike_id: workflow.id,
      name: workflow.name ?? SELECTED_WRIKE_WORKFLOW.expectedName,
      description: workflow.description ?? null,
      hidden: workflow.hidden ?? false,
      raw_data: workflow,
      synced_at: now,
      updated_at: now
    }, { onConflict: "organization_id,wrike_id" });
    if (workflowError) failures.push(failureFor("database", workflow.id, workflowError));
    if (statuses.length) {
      const { error: statusError } = await db.from("wrike_workflow_statuses").upsert(statuses.map((status) => ({
        organization_id: organizationId,
        wrike_id: status.id,
        workflow_id: workflow.id,
        title: status.name,
        status_group: status.group ?? null,
        standard: status.standard ?? null,
        hidden: status.hidden ?? null,
        color: status.color ?? null,
        raw_data: status,
        synced_at: now,
        updated_at: now
      })), { onConflict: "organization_id,wrike_id" });
      if (statusError) failures.push(failureFor("database", workflow.id, statusError));
      else workflowStatusesUpserted = statuses.length;
    }
  } catch (error) {
    const failure = failureFor("workflow", SELECTED_WRIKE_WORKFLOW.wrikeWorkflowId, error);
    failures.push(failure);
    workflowFailed = true;
    logWrikeEvent("warn", "wrike_workflow_reference_failed", failure);
  }
  const workflowDurationMs = Date.now() - workflowStartedAt;
  const usersStartedAt = Date.now();
  const { data: existingUsers, error: existingUserError } = await db.from("wrike_users").select("wrike_id").eq("organization_id", organizationId).in("wrike_id", SELECTED_WRIKE_USER_IDS);
  if (existingUserError) failures.push(failureFor("database", null, existingUserError));
  else {
    const existingIds = new Set((existingUsers ?? []).map((user) => user.wrike_id));
    const fallbacks = SELECTED_WRIKE_USERS.filter((user) => !existingIds.has(user.wrikeUserId)).map((user) => ({
      organization_id: organizationId,
      wrike_id: user.wrikeUserId,
      display_name: user.expectedName,
      raw_data: { referenceSource: "configured_fallback" },
      is_active: true,
      updated_at: now
    }));
    if (fallbacks.length) {
      const { error } = await db.from("wrike_users").upsert(fallbacks, { onConflict: "organization_id,wrike_id", ignoreDuplicates: true });
      if (error) failures.push(failureFor("database", null, error));
      else fallbackCreated = fallbacks.length;
    }
  }

  const userFetch = await fetchSelectedWrikeUsers(client);
  failures.push(...userFetch.failures);
  const retrieved = userFetch.retrieved;
  for (const { configured, user } of retrieved) {
    const returnedName = fullName(user);
    if (returnedName && normalizedName(returnedName) !== normalizedName(configured.expectedName)) {
      const mismatch = { wrikeUserId: configured.wrikeUserId, expectedName: configured.expectedName, returnedName };
      nameMismatches.push(mismatch);
      logWrikeEvent("warn", "wrike_user_name_mismatch", mismatch);
    }
  }
  let usersUpserted = 0;
  if (retrieved.length) {
    const rows = retrieved.map(({ configured, user }) => {
      const accountProfile = user.profiles?.find((profile) => profile.accountId === accountId) ?? user.profiles?.[0];
      const returnedName = fullName(user);
      return {
        organization_id: organizationId,
        wrike_id: user.id,
        first_name: user.firstName ?? null,
        last_name: user.lastName ?? null,
        display_name: returnedName || configured.expectedName,
        email: user.primaryEmail ?? accountProfile?.email ?? null,
        title: user.title ?? null,
        avatar_url: user.avatarUrl ?? null,
        timezone: user.timezone ?? null,
        locale: user.locale ?? null,
        profiles: user.profiles ?? [],
        raw_data: user,
        is_active: accountProfile?.active ?? !user.deleted,
        deleted_at: user.deleted ? now : null,
        synced_at: now,
        updated_at: now
      };
    });
    const { error } = await db.from("wrike_users").upsert(rows, { onConflict: "organization_id,wrike_id" });
    if (error) failures.push(failureFor("database", null, error));
    else usersUpserted = rows.length;
  }

  const usersDurationMs = Date.now() - usersStartedAt;
  const categoriesStartedAt = Date.now();
  const categoryFetch = await fetchWrikeTimelogCategories(client);
  failures.push(...categoryFetch.failures);
  const uniqueCategories = categoryFetch.categories;
  let categoriesUpserted = 0;
  if (uniqueCategories.length) {
    const { error } = await db.from("wrike_timelog_categories").upsert(uniqueCategories.map((category) => ({
      organization_id: organizationId,
      wrike_id: category.id,
      title: category.name ?? category.title ?? category.id,
      hidden: category.hidden ?? false,
      sort_order: category.order ?? null,
      raw_data: category,
      synced_at: now,
      updated_at: now
    })), { onConflict: "organization_id,wrike_id" });
    if (error) failures.push(failureFor("database", null, error));
    else categoriesUpserted = uniqueCategories.length;
  }

  const categoriesDurationMs = Date.now() - categoriesStartedAt;
  const [{ data: userRows, error: userRowsError }, { data: categoryRows, error: categoryRowsError }, { data: statusRows, error: statusRowsError }] = await Promise.all([
    db.from("wrike_users").select("id,wrike_id,display_name,email,avatar_url,synced_at").eq("organization_id", organizationId),
    db.from("wrike_timelog_categories").select("wrike_id,title").eq("organization_id", organizationId),
    db.from("wrike_workflow_statuses").select("wrike_id,title").eq("organization_id", organizationId).eq("workflow_id", SELECTED_WRIKE_WORKFLOW.wrikeWorkflowId)
  ]);
  if (userRowsError) failures.push(failureFor("database", null, userRowsError));
  if (categoryRowsError) failures.push(failureFor("database", null, categoryRowsError));
  if (statusRowsError) failures.push(failureFor("database", SELECTED_WRIKE_WORKFLOW.wrikeWorkflowId, statusRowsError));
  const diagnostics: ReferenceSyncDiagnostics = {
    workflow: { requests: 1, selectedId: SELECTED_WRIKE_WORKFLOW.wrikeWorkflowId, found: workflowFound, statusesReceived: workflowStatusesReceived, statusesUpserted: workflowStatusesUpserted, failed: workflowFailed, durationMs: workflowDurationMs },
    users: {
      configured: SELECTED_WRIKE_USERS.length,
      requested: SELECTED_WRIKE_USERS.length,
      received: retrieved.length,
      upserted: usersUpserted,
      fallbackCreated,
      failed: failures.filter((failure) => failure.operation === "user").length,
      failedIds: failures.filter((failure) => failure.operation === "user" && failure.wrikeId).map((failure) => failure.wrikeId!),
      nameMismatches,
      durationMs: usersDurationMs
    },
    categories: { requests: categoryFetch.requests, received: uniqueCategories.length, upserted: categoriesUpserted, paginationObserved: categoryFetch.paginationObserved, failed: categoryFetch.failed, durationMs: categoriesDurationMs },
    failures
  };
  return { diagnostics, userRows: (userRows ?? []) as WrikeUserReferenceRow[], categoryRows: (categoryRows ?? []) as WrikeCategoryReferenceRow[], statusRows: (statusRows ?? []) as WrikeStatusReferenceRow[] };
}
