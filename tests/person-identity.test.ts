import { afterEach, describe, expect, it, vi } from "vitest";
import { projectOverviewContactValues } from "@/lib/reporting/projects";
import { WrikeClient } from "@/lib/wrike/client";
import {
  contactsQueryPath,
  matchPersonIdentity,
  mergePersonIdentity,
  normalizePersonName,
  personIdentityDue,
  processPendingPersonIdentities,
  isVerifiablePersonName,
  taskPersonIdentityObservations,
  wrikeContactNameSearchUrl,
  type StoredPersonIdentity,
  type WrikeContact
} from "@/lib/wrike/person-identity";

afterEach(() => vi.unstubAllGlobals());

const person = (id: string, firstName: string, lastName: string, email?: string): WrikeContact => ({
  id, firstName, lastName, primaryEmail: email, type: "Person", active: true
});

function stored(overrides: Partial<StoredPersonIdentity> = {}): StoredPersonIdentity {
  return {
    identity_key: "name:katie willis",
    display_name: "Katie Willis",
    normalized_name: "katie willis",
    first_name: null,
    last_name: null,
    email: null,
    wrike_contact_id: null,
    contact_active: null,
    contact_deleted: null,
    is_displayable: true,
    is_verified: false,
    verification_source: "task_name",
    verification_status: "unverified",
    candidate_contacts: [],
    source_task_ids: ["TASK1"],
    verification_attempt_count: 0,
    last_verification_attempt_at: null,
    next_verification_attempt_at: null,
    last_verified_at: null,
    last_error: null,
    raw_data: {},
    ...overrides
  };
}

function identityDb(readRows: StoredPersonIdentity[]) {
  const identityUpserts: Record<string, unknown>[] = [];
  const userUpserts: Record<string, unknown>[] = [];
  const db = { from(table: string) {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order", "limit"]) builder[method] = () => builder;
    builder.then = (resolve: (value: unknown) => void) => resolve({ data: table === "wrike_person_identities" ? readRows : [], error: null });
    builder.upsert = (rows: Record<string, unknown> | Record<string, unknown>[]) => {
      const target = table === "wrike_person_identities" ? identityUpserts : userUpserts;
      target.push(...(Array.isArray(rows) ? rows : [rows]));
      return Promise.resolve({ error: null });
    };
    return builder;
  } };
  return { db: db as never, identityUpserts, userUpserts };
}

describe("Wrike person identity matching", () => {
  it("keeps a readable task name displayable without claiming it is verified", () => {
    expect(normalizePersonName("  Katie   WILLIS ")).toBe("katie willis");
    expect(projectOverviewContactValues(["Katie Willis"], [])[0]).toMatchObject({
      label: "Katie Willis", displayable: true, verified: false, verificationSource: "task_name", resolved: true
    });
  });

  it("queues readable first-and-last names but excludes single labels and raw IDs from verification", () => {
    expect(isVerifiablePersonName("Devin Weiss")).toBe(true);
    expect(isVerifiablePersonName("Devin")).toBe(false);
    expect(isVerifiablePersonName("KUALR6DZ")).toBe(false);
  });

  it("verifies exactly one exact normalized-name match", () => {
    const result = matchPersonIdentity({ displayName: "  KATIE   willis ", email: null }, [
      person("KATIE001", "Katie", "Willis"), person("OTHER001", "Katherine", "Willis")
    ]);
    expect(result).toMatchObject({ status: "verified", source: "wrike_contact", contact: { id: "KATIE001" } });
  });

  it("uses one exact email to disambiguate matching contacts before comparing names", () => {
    const result = matchPersonIdentity({ displayName: "Katie Willis", email: "KATIE@example.com" }, [
      person("KATIE001", "Katie", "Willis", "katie@example.com"),
      person("KATIE002", "Katie", "Willis", "other@example.com")
    ]);
    expect(result).toMatchObject({ status: "verified", source: "email_match", contact: { id: "KATIE001" } });
  });

  it("does not choose between contacts with the same exact name", () => {
    const result = matchPersonIdentity({ displayName: "Katie Willis", email: null }, [
      person("KATIE001", "Katie", "Willis"), person("KATIE002", "Katie", "Willis")
    ]);
    expect(result).toMatchObject({ status: "ambiguous", contact: null });
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["KATIE001", "KATIE002"]);
  });

  it("retains a readable name as unverified when no contact matches", () => {
    expect(matchPersonIdentity({ displayName: "Katie Willis", email: null }, [person("OTHER001", "Alex", "Smith")]))
      .toMatchObject({ status: "not_found", contact: null, candidates: [] });
  });

  it("marks a raw ID as unavailable and separate from a readable identity", () => {
    expect(projectOverviewContactValues(["KUMISSING"], [])[0]).toMatchObject({
      label: "KUMISSING", displayable: false, verified: false, verificationSource: "unresolved", resolved: false
    });
  });

  it("never downgrades a previously verified mapping with task-name-only data", () => {
    const existing = stored({
      display_name: "Katherine Willis",
      normalized_name: "katherine willis",
      email: "katie@example.com",
      wrike_contact_id: "KATIE001",
      is_verified: true,
      verification_source: "email_match",
      verification_status: "verified",
      last_verified_at: "2026-07-22T12:00:00.000Z"
    });
    const merged = mergePersonIdentity(existing, stored({ display_name: "Katie Willis", source_task_ids: ["TASK2"] }));
    expect(merged).toMatchObject({
      display_name: "Katherine Willis", wrike_contact_id: "KATIE001", is_verified: true,
      verification_source: "email_match", verification_status: "verified"
    });
    expect(merged.source_task_ids).toEqual(["TASK1", "TASK2"]);
  });

  it("extracts and deduplicates readable Contacts-field identities", () => {
    const tasks = [
      { id: "TASK1", title: "One", status: "Active" },
      { id: "TASK2", title: "Two", status: "Active" }
    ];
    const metadata = new Map(tasks.map((task) => [task.id, {
      folderIds: [], folders: [], folderNames: [], customFieldsNormalized: [],
      customFields: [{ id: "CONTACTS", title: "Designer", type: "Contacts", rawValue: "  Katie   Willis ", displayValue: "Katie Willis", resolved: true }]
    }]));
    expect(taskPersonIdentityObservations(tasks, metadata as never)).toEqual([
      { displayName: "Katie Willis", email: null, sourceTaskIds: ["TASK1", "TASK2"] }
    ]);
  });

  it("builds people-only active contact queries using name or email filters", () => {
    const byName = contactsQueryPath({ name: " Katie   Willis " });
    const byEmail = contactsQueryPath({ emails: ["KATIE@example.com"] });
    expect(decodeURIComponent(byName)).toContain('types=["Person"]');
    expect(decodeURIComponent(byName)).toContain("active=true");
    expect(byName).toContain("name=Katie%20Willis");
    expect(decodeURIComponent(byEmail)).toContain('emails=["katie@example.com"]');
  });

  it("constructs the exact account-specific Devin Weiss URL and safely encodes other names", () => {
    expect(wrikeContactNameSearchUrl("https://www.wrike.com/api/v4", "Devin Weiss"))
      .toBe("https://www.wrike.com/api/v4/contacts?name=Devin%20Weiss");
    expect(wrikeContactNameSearchUrl("https://app-eu.wrike.com/api/v4/", " Anne-Marie  O’Neil "))
      .toBe("https://app-eu.wrike.com/api/v4/contacts?name=Anne-Marie%20O%E2%80%99Neil");
  });

  it("enforces retry delays and protects verified and manually mapped identities", () => {
    const now = new Date("2026-07-22T12:00:00.000Z");
    expect(personIdentityDue(stored({ next_verification_attempt_at: "2026-07-22T13:00:00.000Z" }), now)).toBe(false);
    expect(personIdentityDue(stored({ next_verification_attempt_at: "2026-07-22T11:00:00.000Z" }), now)).toBe(true);
    expect(personIdentityDue(stored({ is_verified: true }), now)).toBe(false);
    expect(personIdentityDue(stored({ verification_source: "manual_mapping" }), now)).toBe(false);
  });

  it("deduplicates repeated names before a background lookup", async () => {
    const state = identityDb([]);
    const client = { all: vi.fn(async () => [person("DEVIN001", "Devin", "Weiss")]) };
    const result = await processPendingPersonIdentities(state.db, "ORG", client as never, [
      { displayName: "Devin Weiss", email: null, sourceTaskIds: ["TASK1"] },
      { displayName: "  DEVIN   WEISS ", email: null, sourceTaskIds: ["TASK2"] }
    ], new Date("2026-07-22T12:00:00.000Z"));
    expect(client.all).toHaveBeenCalledTimes(1);
    expect(result.diagnostics).toMatchObject({ observed: 2, deduplicated: 1, attempted: 1, verified: 1 });
    expect(state.identityUpserts).toHaveLength(1);
    expect(state.identityUpserts[0]).toMatchObject({ wrike_contact_id: "DEVIN001", first_name: "Devin", last_name: "Weiss", is_verified: true });
  });

  it("skips a future retry and lets one failed lookup coexist with a successful batch result", async () => {
    const future = stored({ identity_key: "name:future person", display_name: "Future Person", normalized_name: "future person", next_verification_attempt_at: "2026-07-23T12:00:00.000Z" });
    const skippedState = identityDb([future]);
    const skippedClient = { all: vi.fn() };
    const skipped = await processPendingPersonIdentities(skippedState.db, "ORG", skippedClient as never, [], new Date("2026-07-22T12:00:00.000Z"));
    expect(skipped.diagnostics).toMatchObject({ attempted: 0, skipped: 1 });
    expect(skippedClient.all).not.toHaveBeenCalled();

    const failed = stored({ identity_key: "name:failed person", display_name: "Failed Person", normalized_name: "failed person" });
    const good = stored({ identity_key: "name:good person", display_name: "Good Person", normalized_name: "good person" });
    const state = identityDb([failed, good]);
    const client = { all: vi.fn(async (path: string) => {
      if (path.includes("Failed%20Person")) throw new Error("temporary contact failure");
      return [person("GOOD0001", "Good", "Person")];
    }) };
    const result = await processPendingPersonIdentities(state.db, "ORG", client as never, [], new Date("2026-07-22T12:00:00.000Z"));
    expect(result.diagnostics).toMatchObject({ attempted: 2, verified: 1, failed: 1 });
    expect(state.identityUpserts).toEqual(expect.arrayContaining([
      expect.objectContaining({ identity_key: "name:good person", is_verified: true }),
      expect.objectContaining({ identity_key: "name:failed person", verification_status: "failed", next_verification_attempt_at: "2026-07-22T13:00:00.000Z" })
    ]));
  });

  it("persists ambiguous and not-found outcomes separately with retry schedules", async () => {
    const state = identityDb([]);
    const client = { all: vi.fn(async (path: string) => path.includes("Alex%20Smith")
      ? [person("ALEX0001", "Alex", "Smith"), person("ALEX0002", "Alex", "Smith")]
      : [person("OTHER001", "Other", "Person")]) };
    const result = await processPendingPersonIdentities(state.db, "ORG", client as never, [
      { displayName: "Alex Smith", email: null, sourceTaskIds: ["TASK1"] },
      { displayName: "Missing Person", email: null, sourceTaskIds: ["TASK2"] }
    ], new Date("2026-07-22T12:00:00.000Z"));
    expect(result.diagnostics).toMatchObject({ ambiguous: 1, notFound: 1, failed: 0 });
    expect(state.identityUpserts).toEqual(expect.arrayContaining([
      expect.objectContaining({ identity_key: "name:alex smith", verification_status: "ambiguous", next_verification_attempt_at: "2026-07-23T12:00:00.000Z" }),
      expect.objectContaining({ identity_key: "name:missing person", verification_status: "not_found", next_verification_attempt_at: "2026-07-29T12:00:00.000Z" })
    ]));
  });

  it("inherits pagination, expired-token refresh, and transient retry handling from WrikeClient", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "expired" }), { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [person("DEVIN001", "Devin", "Weiss")], nextPageToken: "page two" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [person("DEVIN002", "Devin", "Weiss")] }), { status: 200 }));
    const refresh = vi.fn(async () => ({ accessToken: "fresh", apiBaseUrl: "https://app-eu.wrike.com/api/v4" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new WrikeClient("expired", "https://www.wrike.com/api/v4", { onUnauthorized: refresh });
    await expect(client.all<WrikeContact>(contactsQueryPath({ name: "Devin Weiss" }))).resolves.toHaveLength(2);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[2][0]).toContain("https://app-eu.wrike.com/api/v4/contacts?name=Devin%20Weiss");
    expect(fetchMock.mock.calls[3][0]).toContain("nextPageToken=page%20two");
  });
});
