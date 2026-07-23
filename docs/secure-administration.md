# Secure administration

Migrations `202607230009_application_principals_and_impersonation.sql`,
`202607230010_retryable_user_offboarding.sql`, and
`202607230011_superadmin_id_persona.sql` must be deployed in that order before
the corresponding application build.

## Administrator impersonation

Impersonation preserves the administrator's Supabase Auth session. DevTrack
creates a random `sessionId.secret` token, stores only its SHA-256 hash, and
places the token in a Secure, HttpOnly, SameSite=Lax cookie. Server-side
Supabase clients forward that token only to PostgREST in the
`x-devtrack-impersonation` request header. It is never supplied to Supabase
Auth or Storage.

The database validates the token hash, authenticated actor, originating Auth
`session_id`, organization, active membership, role matrix, 15-minute
inactivity limit, and 60-minute absolute limit in the same request transaction.
Supplying any invalid impersonation token resolves to no effective identity;
it does not fall back to administrator privileges.

SuperAdmin may impersonate Admin, ID, or SME. Admin may impersonate ID or SME.
Self, nested, incomplete, inactive, deletion-pending, cross-organization, and
SuperAdmin targets are unavailable. A persistent banner identifies the actor
and effective user. Explicit pointer, keyboard, or touch interaction sends a
throttled activity heartbeat. Background fetching does not extend a session.

Password/recovery, logout, invitations, role/mapping/persona changes, deletion,
and Wrike connection changes are blocked while impersonating. Business
mutations authorize as the effective user and security audits retain both the
authenticated actor and effective principal.

## User offboarding

Deletion is a retryable job with one durable stage per request:

1. Mark the membership `deletion_pending`, revoke impersonations, and ban Auth.
2. Remove draft-only private Storage objects.
3. Restore unlocked submissions to their latest immutable revisions; remove
   drafts, pending edits, setup state, conversations, memberships, mappings,
   personas, and matching invitations; then remove the active membership.
4. Hard-delete the Supabase Auth user.
5. Mark the job finalized.

Missing Storage objects or Auth users are treated as already complete. Failed
jobs remain visible in User Management with a retry action. Reinvitation for
the normalized email is blocked until finalization.

Submitted surveys, immutable revisions, submitted invoice objects, finalized
course drafts, and security/business audits remain. They reference a stable,
non-login principal and display `Deleted user`; former display names and email
addresses are not retained. The principal keeps only its original UUID,
organization, primary-role snapshot, timestamps, and normalized-email hash.

`application_user_deletion_manifest` classifies every foreign key that
identifies an application user. Both migrations call
`assert_application_user_deletion_manifest_complete()`, so adding an
unclassified user reference fails database migration/test execution.

## Fixed SuperAdmin ID persona

Only the fixed `dweiss@lexipol.com` SuperAdmin can hold the secondary ID
operational persona. It does not change the account's primary `super_admin`
role. The selected Wrike identity must be active, verified, organization
scoped, and unused by another active ID account or persona.

The ID Dashboard defaults to the persona's own assignment view. ID-review and
finalized-draft mutations require that persona to be a trusted assignee on the
project. Selecting another ID remains an explicitly read-only administrative
view and grants no project action or survey credit.

## Deployment checks

After applying all three migrations and deploying the application:

- Start and exit one impersonation and verify the original session is restored.
- Verify inactivity and absolute expiry clear the banner and cookie.
- Confirm security-sensitive endpoints reject requests while impersonating.
- Run a staged deletion through finalization, then test retry from a deliberately
  failed Storage or Auth stage.
- Confirm submitted history reads `Deleted user` and a later invitation creates
  a new Auth UUID with no inherited access.
- Assign the fixed SuperAdmin ID persona, verify own assigned projects permit
  ID actions, and verify another ID's selected dashboard is read-only.

