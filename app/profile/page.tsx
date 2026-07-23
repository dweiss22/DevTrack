import { AppShell } from "@/components/app-shell";
import { ProfileForm } from "@/components/profile-form";
import { requireContext } from "@/lib/auth";

export default async function ProfilePage() {
  const { user, profile } = await requireContext();
  return <AppShell isAdmin={profile.role === "admin"}><header className="page-header"><div><p className="eyebrow">YOUR ACCOUNT</p><h1>Profile</h1><p>Update how your name appears in DevTrack. Your email, organization, and role are managed separately.</p></div></header><ProfileForm email={user.email ?? "Unavailable"} initialDisplayName={profile.display_name ?? ""} role={profile.role} /></AppShell>;
}
