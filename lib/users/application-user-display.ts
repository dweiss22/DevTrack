type AuthenticationUser = {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function applicationUserDisplayName(displayName: string | null, authUser?: AuthenticationUser) {
  const metadata = authUser?.user_metadata;
  return nonEmptyString(displayName)
    ?? nonEmptyString(metadata?.full_name)
    ?? nonEmptyString(metadata?.name)
    ?? nonEmptyString(metadata?.display_name)
    ?? nonEmptyString(authUser?.email)
    ?? "Unnamed user";
}

export function applicationUserEmail(authUser?: AuthenticationUser) {
  return nonEmptyString(authUser?.email) ?? "Not available";
}
