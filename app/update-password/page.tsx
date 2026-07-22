import { UpdatePasswordForm } from "@/components/update-password-form";

export default function UpdatePasswordPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return <UpdatePasswordForm configurationError="Password setup is not configured for this environment." />;
  return <UpdatePasswordForm />;
}
