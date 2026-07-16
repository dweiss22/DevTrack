import crypto from "node:crypto";
import { env } from "@/lib/env";

function key() {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new Error("TOKEN_ENCRYPTION_KEY is required before connecting Wrike.");
  return crypto.createHash("sha256").update(env.TOKEN_ENCRYPTION_KEY).digest();
}
export function seal(value: string) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}
export function unseal(value: string) {
  const [ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("Stored Wrike credential is invalid.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
}
export function signedState(payload: Record<string, string>) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 10 * 60_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function verifyState(value: string) {
  const [body, sig] = value.split(".");
  const expected = crypto.createHmac("sha256", key()).update(body).digest("base64url");
  if (!sig || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error("Invalid OAuth state.");
  const state = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, string | number>;
  if (typeof state.exp !== "number" || state.exp < Date.now()) throw new Error("OAuth state has expired.");
  return state as Record<string, string>;
}
