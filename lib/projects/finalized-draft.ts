import { z } from "zod";

export const finalizedCourseDraftUrlSchema = z.string().trim().max(2048).superRefine((value, context) => {
  if (/[\s\u0000-\u001f\u007f]/.test(value)) {
    context.addIssue({ code: "custom", message: "The finalized course draft link cannot contain whitespace or control characters." });
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    context.addIssue({ code: "custom", message: "Enter a valid absolute HTTPS URL." });
    return;
  }
  if (parsed.protocol !== "https:") {
    context.addIssue({ code: "custom", message: "The finalized course draft link must use HTTPS." });
  }
  if (parsed.username || parsed.password) {
    context.addIssue({ code: "custom", message: "URLs containing embedded credentials are not allowed." });
  }
  if (!parsed.hostname) {
    context.addIssue({ code: "custom", message: "Enter a valid absolute HTTPS URL." });
  }
});

export type FinalizedDraftStatus = {
  available: boolean;
  url?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  canManage?: boolean;
};
