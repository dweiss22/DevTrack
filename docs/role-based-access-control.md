# Role-based access control

Migration `202607230003_role_based_access_control.sql` establishes four application roles. `public.application_users` is the authoritative source; roles are never trusted from browser input or stored in user-editable Supabase Auth metadata.

| Capability | SuperAdmin | Admin | ID | SME |
| --- | ---: | ---: | ---: | ---: |
| Standard read-only product pages | Yes | Yes | Yes | No |
| Administration, integrations, and data management | Yes | Yes | No | No |
| User Management and invitations | Yes | Yes | No | No |
| Assign Admin, ID, or SME | Yes | Yes | No | No |
| SME Dashboard | Yes | Yes | Yes | Yes |
| Select an eligible SME | Yes | Yes | Yes | No |
| Edit own profile | Yes | Yes | Yes | Yes |

The database values are `super_admin`, `admin`, `id`, and `sme`. The reusable capability matrix is defined in `lib/auth/roles.ts` and is used for navigation, page guards, API authorization, and post-login landing behavior.

## Fixed SuperAdmin

`dweiss@lexipol.com`, compared after trimming and lowercasing, is the only permitted SuperAdmin identity. The migration:

- converts that existing application membership to `super_admin`;
- converts other existing administrators to `admin`;
- converts legacy and unknown ordinary roles conservatively to `id`;
- rejects assigning `super_admin` to any other Auth email;
- rejects deleting, demoting, or moving the fixed SuperAdmin application membership;
- prevents the fixed Auth identity from being deleted or having its email changed or transferred; and
- excludes `super_admin` from invitation and ordinary role-change inputs.

User Management displays the fixed account but locks its role. The normal profile endpoint can change only the authenticated user's display name.

## SME identity and reporting boundary

An SME application membership can reference one canonical `wrike_users.id` through `application_users.wrike_user_id`. The reference must belong to the same organization and must be an active, resolved synchronized identity. A partial unique index prevents one organization from mapping the same Wrike identity to multiple application users.

Administrators manage the mapping in User Management. DevTrack does not infer a mapping from a display name. A missing or unresolved mapping produces an empty state and returns no task rows.

The dashboard RPC validates all of the following in the database:

- the caller has an application membership;
- the selected application user is an SME in the caller's organization;
- an SME caller can select only their own application-user ID; and
- every task row joins through that SME's mapped `wrike_task_assignees.user_id`.

For defense in depth, SMEs receive no organization from `current_organization_id()`. Existing reporting RPCs and organization-scoped RLS therefore return no standard reporting data to SME callers. Restrictive read policies also block direct table reads. The two SME Dashboard RPCs are the only authenticated reporting functions that resolve SME membership independently.

## Route behavior

- SME login, invitation completion, and confirmation land on `/sme-dashboard`.
- An SME opening a standard or administrative page is redirected to `/sme-dashboard`.
- ID users can use standard read-only pages and the SME Dashboard, but server guards deny administrative pages and APIs.
- Admin and SuperAdmin use all existing operational functionality.

Middleware performs broad authentication gating. Server components and API routes independently call capability guards before loading protected data or using the service-role client.

## Deployment and verification

Apply all migrations in filename order, including:

1. `202607230002_application_user_invitations.sql`
2. `202607230003_role_based_access_control.sql`

After deployment:

1. Confirm `dweiss@lexipol.com` appears as locked SuperAdmin.
2. Assign each ordinary account the intended Admin, ID, or SME role.
3. Map every SME to one active synchronized Wrike identity in User Management.
4. Test one account of each role, including direct navigation to a forbidden route.
5. Compare an SME's dashboard with the same SME selected by an ID or administrator.
6. Confirm an unmapped SME returns no task data.

Scheduled jobs and synchronization continue to use the service role and are not restricted by end-user RLS.
