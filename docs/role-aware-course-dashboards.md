# Role-aware course dashboards

DevTrack exposes assignment-driven course-development views at `/sme-dashboard` and
`/id-dashboard`. Both dashboards derive their data from synchronized Wrike records and
caller-aware database functions; browser-supplied identity IDs are never treated as
authorization.

## Authorization

- SMEs see only the eligible courses assigned to their verified, mapped Wrike identity.
- IDs see only the eligible courses assigned to their verified, mapped Wrike identity.
  They retain the existing capability to inspect an SME assignment view.
- Admins and SuperAdmins may select a verified SME or ID identity. This is an assignment
  view, not impersonation: surveys they create remain attributed to their own account.
- Only Admins and SuperAdmins may select another ID on the ID Dashboard.
- An unmapped verified SME may be the subject of an ID review, but a debrief requires an
  active SME application account mapped to that identity.

Eligible records are undeleted organization tasks in the Online Learning workflow
`IEACHQK7K4BHMLHM`, either directly or through a resolved workflow status. Normalized
SME and owner/ID custom fields are authoritative. A synchronized task assignment from a
mapped user of the matching role is used only when the role field is absent. Conflicting,
ambiguous, inactive, cross-organization, or unverified identities receive no task rows
or survey actions.

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

## Deployment

1. Apply migrations with `npx supabase migration list` and `npx supabase db push`.
2. Redeploy the application build containing the new routes and RPC calls.
3. In User Management, map each active SME and ID account to an active, verified Wrike
   identity. Changing an account to Admin clears the mapping.
4. Confirm at least one mapped SME and ID can open their own dashboard, and that an
   administrator can use both selectors without changing survey authorship.
5. Confirm an unmapped verified SME appears to authorized internal users, can be
   reviewed by an ID, and shows “Account mapping required” for debriefs.

The survey invoice bucket remains private. Dashboard and survey list RPCs do not return
private storage object keys.
