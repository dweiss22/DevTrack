import Link from "next/link";
import { redirect } from "next/navigation";
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

  return <main className="login"><section className="card"><p className="eyebrow">DEVTRACK</p><h1>Access awaiting approval</h1><p>Your account was authenticated, but it has not been assigned to a DevTrack organization.</p><dl className="identity-details"><dt>Email</dt><dd>{user.email ?? "Unavailable"}</dd><dt>Supabase user ID</dt><dd><code>{user.id}</code></dd></dl><p>Ask a DevTrack administrator to add this user ID to <code>public.application_users</code>, then try again.</p><Link className="button" href="/">Check access again</Link></section></main>;
}
