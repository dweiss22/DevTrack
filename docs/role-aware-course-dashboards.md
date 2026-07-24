# Role-aware course dashboards

DevTrack exposes assignment-driven course-development views at `/sme-dashboard` and
`/id-dashboard`. Both dashboards derive their data from synchronized Wrike records and
caller-aware database functions; browser-supplied identity IDs are never treated as
authorization.

Assigned SMEs open `/sme-dashboard/projects/[projectId]`, not the internal project
detail route. The restricted route is populated by `sme_project_detail` and returns
only the approved course fields, the authenticated SME's own debrief, safe invoice
metadata, and the finalized-course-draft availability/link. It does not query or
serialize raw Wrike payloads, internal reviews, other users' time entries, or audit
history.

## Authorization

- SMEs see only the eligible courses assigned to their verified, mapped Wrike identity.
- IDs see only the eligible courses assigned to their verified, mapped Wrike identity.
  They retain the existing capability to inspect an SME assignment view.
- Admins and SuperAdmins may select a verified SME or ID identity. This is an assignment
  view, not impersonation: surveys they create remain attributed to their own account.
- Only Admins and SuperAdmins may select another ID on the ID Dashboard.
- Project-level ID review and finalized-draft controls are returned only when the
  authenticated ID's mapped Wrike identity is the trusted assigned ID. Selecting an ID
  as an administrator does not grant those controls.
- An unmapped verified SME may be the subject of an ID review, but a debrief requires an
  active SME application account mapped to that identity.

Eligible records are undeleted organization tasks in the Online Learning workflow
`IEACHQK7K4BHMLHM`, either directly or through a resolved workflow status. Normalized
SME and owner/ID custom fields are authoritative. A synchronized task assignment from a
mapped user of the matching role is used only when the role field is absent. Conflicting,
ambiguous, inactive, cross-organization, or unverified ID identities receive no task
rows or survey actions.

Assignment text is compared with active, verified Wrike identities by stable Wrike ID,
email, or a unique case- and diacritic-insensitive canonical name. Safely separable
comma- or semicolon-delimited people are resolved independently. This allows readable
values such as `Devin Weiss`, spelling variants such as `Koco Budo` / `Koço Budo`, and
multi-person values to reuse an already verified canonical identity without creating a
second unresolved dashboard option.

An ID-assigned course remains on the ID Dashboard when its SME field is missing,
conflicting, or does not uniquely resolve. The course shows the safe synchronized SME
labels and a resolution warning, while SME-review actions stay unavailable. A verified
SME identity is still required before a review can be created.

## Database interfaces

Migration `202607230005_role_aware_sme_id_dashboards.sql` installs the assignment
helpers and these caller-aware RPCs:

- `reporting_sme_dashboard_identities`
- `reporting_sme_dashboard_rows`
- `reporting_current_id_identity`
- `reporting_id_dashboard_identities`
- `reporting_id_dashboard_rows`
- `survey_browse`

It also adds the four-argument survey create/resume function used to identify an ID
review subject by verified Wrike identity. The previous SME-specific mapping function
remains as a compatibility wrapper.

Migration `202607230008_restricted_sme_projects_and_finalized_drafts.sql` adds:

- private, organization-scoped `project_finalized_course_drafts` records;
- append-only finalized-draft audit events that intentionally omit URLs;
- transactional assigned-ID save/removal functions with authoritative HTTPS URL
  validation;
- restricted SME project detail and assigned-ID project-control RPCs; and
- assigned-ID enforcement in survey context resolution.

Migration `202607240001_correct_id_dashboard_course_resolution.sql` adds canonical
person-name normalization and safe multi-person tokenization, updates unresolved-value
reporting, and makes the ID Dashboard retain trusted ID courses with unresolved SME
evidence. It operates on existing normalized values; no assignment backfill is needed.

## Deployment

1. Apply migrations with `npx supabase migration list` and `npx supabase db push`.
2. Redeploy the application build containing the new routes and RPC calls.
3. In User Management, map each active SME and ID account to an active, verified Wrike
   identity. Changing an account to Admin clears the mapping.
4. Confirm at least one mapped SME and ID can open their own dashboard, and that an
   administrator can use both selectors without changing survey authorship.
5. Confirm an unmapped verified SME appears to authorized internal users, can be
   reviewed by an ID, and shows “Account mapping required” for debriefs.

6. Confirm Devin Weiss no longer appears as both a selectable identity and an
   unverified assignment value, and compare Devin's and Koço Budo's course counts with
   the trusted ID resolver.
7. Confirm a course with an unresolved or conflicting SME remains visible to its ID,
   clearly warns about the SME assignment, and offers no SME-review action.

The survey invoice bucket remains private. Dashboard and survey list RPCs do not return
private storage object keys.
