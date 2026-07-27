import { AppShell } from "@/components/app-shell";
import { ProfileForm } from "@/components/profile-form";
import { ProfilePasswordForm } from "@/components/profile-password-form";
import { requireContext } from "@/lib/auth";
import { isAdministratorRole } from "@/lib/auth/roles";

export default async function ProfilePage() {
  const { user, profile } = await requireContext();
  return (
    <AppShell isAdmin={isAdministratorRole(profile.role)}>
      <header className="page-header">
        <div>
          <p className="eyebrow">YOUR ACCOUNT</p>
          <h1>Profile</h1>
          <p>Manage how your name appears in DevTrack and update your password. Your email, organization, and role are managed separately.</p>
        </div>
      </header>
      <div className="profile-sections">
        <ProfileForm email={user.email ?? "Unavailable"} initialDisplayName={profile.display_name ?? ""} role={profile.role} />
        <ProfilePasswordForm />
      </div>
    </AppShell>
  );
}
