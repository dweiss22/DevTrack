import { RecoverySessionBridge } from "@/components/recovery-session-bridge";

export default function RecoveryPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const configurationError = supabaseUrl && anonKey
    ? ""
    : "Password setup is not configured for this environment.";

  return <RecoverySessionBridge
    supabaseUrl={supabaseUrl}
    anonKey={anonKey}
    configurationError={configurationError}
  />;
}
