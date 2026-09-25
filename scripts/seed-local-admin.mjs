import { createClient } from "@supabase/supabase-js";

const url = "http://127.0.0.1:54321";
const serviceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const email = "dweiss@lexipol.com";
const password = "LocalDevTest123!";

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: userData, error: userError } = await admin.auth.admin.createUser({
  email, password, email_confirm: true
});
if (userError) { console.error("createUser failed:", userError.message); process.exit(1); }
const userId = userData.user.id;
console.log("Created auth user:", userId);

const { data: org, error: orgError } = await admin.from("organizations").insert({ name: "Local Dev Org" }).select().single();
if (orgError) { console.error("org insert failed:", orgError.message); process.exit(1); }
console.log("Created organization:", org.id);

const { error: appUserError } = await admin.from("application_users").insert({
  id: userId, organization_id: org.id, display_name: "Dev Weiss", role: "super_admin"
});
if (appUserError) { console.error("application_users insert failed:", appUserError.message); process.exit(1); }
console.log("Linked application_users row. Login with:", email, password);
