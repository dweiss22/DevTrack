import { z } from "zod";

export const SME_CLASSIFICATIONS = ["internal", "external"] as const;
export const smeClassificationSchema = z.enum(SME_CLASSIFICATIONS);
export type SmeClassification = z.infer<typeof smeClassificationSchema>;

export type SmeAccountProfile = {
  applicationUserId: string;
  classification: SmeClassification | null;
  updatedAt: string | null;
  updatedByName: string | null;
};

export type TrustedSmeDebriefContext = {
  taskTitle?: string;
  status?: string;
  reportingYear?: number;
  smeClassification?: SmeClassification;
  internalEmployee?: boolean;
  configurationCode?: string;
  configurationMessage?: string;
  subject?: { applicationUserId?: string; wrikeUserId?: string; name?: string };
};

export const smeClassificationLabel = (value: SmeClassification | null | undefined) =>
  value === "internal" ? "Internal SME" : value === "external" ? "External SME" : "SME type not configured";

