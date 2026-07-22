import Link from "next/link";
import { redirect } from "next/navigation";
import { DevTrackBrand } from "@/components/devtrack-brand";
import { createClient } from "@/lib/supabase/server";

export default async function AccessPendingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: applicationUser } = await supabase
    .from("application_users")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (applicationUser) redirect("/");

  return <main className="login"><section className="card"><DevTrackBrand className="login-brand" /><p className="eyebrow">ACCOUNT ACCESS</p><h1>Access awaiting approval</h1><p>Your Microsoft account was authenticated successfully. A DevTrack administrator must approve your account before reporting data is available.</p><dl className="identity-details"><dt>Email</dt><dd>{user.email ?? "Unavailable"}</dd><dt>Account reference</dt><dd><code>{user.id}</code></dd></dl><p>Send the email and account reference above to a DevTrack administrator, then check access again after approval.</p><Link className="button" href="/">Check access again</Link></section></main>;
}
