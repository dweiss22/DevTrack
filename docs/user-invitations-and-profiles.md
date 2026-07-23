# App-managed invitations and profiles

DevTrack administrators invite users from **User Management**. The server creates an organization-scoped preauthorization in `application_user_invitations`, then asks Supabase Auth to email the secure invitation. The browser never receives the Supabase service-role key.

`application_users` remains the authoritative source for organization membership and the four-role authorization model. Roles are not mirrored into Supabase Auth app metadata. Administrators may invite only `Admin`, `ID`, or `SME`; the fixed `SuperAdmin` role is never an invitation option. On the callback, DevTrack matches the authenticated user's normalized Auth email to one open invitation and atomically creates the membership. The invitation cannot be claimed by a different Auth identity, and repeated callbacks do not create duplicate memberships.

## Supabase Auth configuration

In **Authentication → URL Configuration**:

- Set the Site URL to the production value of `NEXT_PUBLIC_APP_URL`.
- Add both `http://localhost:3000/auth/callback` and `http://localhost:3000/auth/confirm` for local development.
- Add both `https://<production-domain>/auth/callback` and `https://<production-domain>/auth/confirm` for production.
- Add callback URLs for any explicitly supported preview domains. Avoid broad wildcard domains unless preview access is intentionally public.

For the **Invite user** email template, use the token-hash SSR confirmation route:

```html
<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=invite">Accept invitation</a>
```

For the **Reset password** template, use the corresponding recovery type:

```html
<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery">Set password</a>
```

DevTrack supplies `/auth/confirm?next=/account-setup` for invitation-related setup and `/auth/confirm?next=/update-password` for ordinary recovery. Do not hard-code a production domain or store invitation tokens in application tables or logs.

Configure the production environment with:

```text
NEXT_PUBLIC_APP_URL=https://<production-domain>
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<public anon key>
SUPABASE_SERVICE_ROLE_KEY=<server-only service role key>
```

Apply migrations `202607230002_application_user_invitations.sql` and `202607230003_role_based_access_control.sql` before deploying the application code.

## Vercel Deployment Protection

Application code cannot bypass Vercel Deployment Protection because Vercel can reject the invitation callback before the request reaches Next.js. Invited users do not need—and should not receive—Vercel accounts or Vercel team invitations.

The production deployment must be publicly reachable at the network layer, with Supabase authentication and DevTrack authorization enforcing application access. In the Vercel project dashboard, configure Deployment Protection so it is disabled for the production environment or applies only to preview deployments. The exact control name can vary by Vercel plan, but no protection mode that requires Vercel authentication may remain on the production invitation URL.

## Operational behavior

- Failed email sends remain visible with a failed status and can be retried.
- Canceling an unused invitation revokes its app preauthorization. DevTrack deletes the unconfirmed Auth identity when it is safe to do so.
- Resending resets an unused, unconfirmed invitation. A confirmed identity receives a secure recovery/setup email instead.
- A valid invited user goes directly to first-time account setup and never enters the access-request approval queue.
- Users who authenticate without an administrator invitation remain on the existing access-pending path.
- Role changes are limited to Admin, ID, and SME. The fixed SuperAdmin cannot be assigned, transferred, demoted, or removed.
- SME invitation completion lands on `/sme-dashboard`; other roles use the normal landing page.

See [Role-based access control](role-based-access-control.md) for the complete capability matrix and database enforcement decisions.
