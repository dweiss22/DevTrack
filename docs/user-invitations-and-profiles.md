# DevTrack user access and password recovery

DevTrack uses one password workflow for first-time access and forgotten
passwords. Administrators add users in **User Management**; users do not need a
Vercel account, a Vercel team invitation, or a separate DevTrack access request.

## Administrator experience

1. Open **Administration → User Management**.
2. Enter the user's email, select `Admin`, `ID`, or `SME`, and select **Add
   user**.
3. DevTrack creates or activates the Supabase Auth identity.
4. DevTrack creates the active `application_users` membership in the
   administrator's organization with the selected role.
5. DevTrack cancels any pending record left by the retired invitation workflow.
6. DevTrack sends the normal Supabase password-recovery email.

The account and membership remain active if the email provider cannot deliver
the automatic message. User Management reports that condition, and the user can
request the same message from **Set up or reset your password** on the sign-in
page. Adding the same active user again is rejected rather than duplicating or
changing their membership.

## User experience

1. The user opens the email sent when the administrator added them, or opens the
   DevTrack sign-in page and selects **Set up or reset your password**.
2. The user enters the exact email address the administrator added.
3. DevTrack checks for both a matching Supabase Auth identity and an active
   `application_users` membership. The response is deliberately identical when
   no eligible account exists.
4. Supabase sends its one-time recovery link.
5. Supabase verifies the token and returns the browser to
   `/auth/recovery`. DevTrack establishes the recovery session without exposing
   the URL-fragment tokens to the application server, removes them from the
   address bar, and opens `/update-password`.
6. The user chooses a password of at least 12 characters.
7. DevTrack checks the active membership again, saves the password, signs out
   other sessions, and opens the landing page for the user's role.
8. Future visits use the normal email-and-password sign-in form. The same
   recovery process remains available whenever the password is forgotten.

## Supabase Auth configuration

In **Authentication → URL Configuration**:

- Set **Site URL** to the exact production `NEXT_PUBLIC_APP_URL`.
- Add `http://localhost:3000/auth/recovery` and
  `http://localhost:3000/auth/callback` for local development.
- Add `https://<production-domain>/auth/recovery` and
  `https://<production-domain>/auth/callback` for production.
- Add preview callbacks only when preview access is intentional.

The recovery template in
[`supabase/email-templates/recovery.html`](../supabase/email-templates/recovery.html)
uses `{{ .ConfirmationURL }}`. This works with Supabase's standard confirmation
URL and does not require an app-generated or archived invitation token. The
retired invite template points to `/recover` and contains no invitation token.

Repository template files do not change the hosted Supabase project
automatically. If the Supabase plan or SMTP configuration does not permit
template editing, the built-in recovery template is compatible with this flow
as long as it retains `{{ .ConfirmationURL }}`.

Configure the application with:

```text
NEXT_PUBLIC_APP_URL=https://<production-domain>
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<public anon key>
SUPABASE_SERVICE_ROLE_KEY=<server-only service role key>
```

## Vercel Deployment Protection

Vercel Authentication must be off for the production deployment. If it remains
on, Vercel rejects the user before DevTrack or Supabase can process the recovery
session and requires a Vercel team account.

Turning that setting off does not itself require a redeploy. The application
changes described here do require a normal production deployment. Users should
never be added to the Vercel team merely to access DevTrack.

## Security retained by the simplified workflow

- Public registration remains disabled.
- Only an authenticated administrator with `manage_users` can create a
  membership.
- `application_users` remains authoritative for organization and role access.
- Password-email requests disclose neither account existence nor provider
  errors.
- Recovery email is sent only for an active DevTrack membership.
- Password update checks the active membership again.
- Supabase controls recovery-token verification and expiration.
- Recovery tokens are removed from the address bar after the session is
  established.
- Passwords require at least 12 characters, and other sessions are signed out
  after a reset.
- The service-role key remains server-only, while database RLS and application
  capabilities continue to protect data.

Already-delivered legacy emails cannot be recalled. An unexpired legacy link is
bridged into the same password page after this version is deployed, so it no
longer opens the retired account-setup path. Legacy records are retained only
for callback compatibility and automatic provisioning, deletion, and cleanup;
they are no longer presented as an administrator-managed workflow.
