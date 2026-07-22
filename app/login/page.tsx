import { LoginForm } from "@/components/login-form";
import { loadAuthenticationAvailability } from "@/lib/auth/providers";
import { safeInternalPath } from "@/lib/auth/redirects";

const reasonMessages: Record<string, string> = {
  configuration_missing: "Sign-in is not configured for this environment. Contact a DevTrack administrator.",
  service_unavailable: "Sign-in services are temporarily unavailable. Please retry.",
  microsoft_unavailable: "Microsoft sign-in is temporarily unavailable. Please retry or use your DevTrack password.",
  callback_failed: "Microsoft sign-in could not be completed. Please try again.",
  password_updated: "Password updated successfully. You can now sign in."
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const next = safeInternalPath(typeof query.next === "string" ? query.next : null);
  const reason = typeof query.reason === "string" ? query.reason : "";
  const availability = await loadAuthenticationAvailability();

  const initialNotice = availability.configurationError && (reason === "configuration_missing" || reason === "service_unavailable") ? "" : reasonMessages[reason] ?? "";
  return <LoginForm availability={availability} returnTo={next} initialNotice={initialNotice} initialError={reason !== "password_updated"} />;
}
