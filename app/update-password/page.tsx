import { redirect } from "next/navigation";
import { UpdatePasswordForm } from "@/components/update-password-form";
import { createClient } from "@/lib/supabase/server";

export default async function UpdatePasswordPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return <UpdatePasswordForm configurationError="Password setup is not configured for this environment." />;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/recover");
  return <UpdatePasswordForm />;
}
