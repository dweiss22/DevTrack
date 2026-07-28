import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { NotificationConfigurationError, ResendNotificationProvider } from "@/lib/notifications/resend";

type Delivery = {
  delivery_id: string;
  event_id: string;
  organization_id: string;
  recipient_application_user_id: string;
  attempt_count: number;
  payload: {
    submissionId: string;
    taskId: string;
    smeApplicationUserId: string;
    smeWrikeUserId: string;
    smeName: string;
    classification: "internal" | "external";
    courseTitle: string;
    reportingYear: number;
    projectStatus: string;
    submittedAt: string;
    billableHours?: number;
    invoicedAmount?: number;
    invoiceAttachmentId?: string;
  };
};

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
}[character] ?? character));

const currency = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(value);

export async function dispatchPendingSmeDebriefNotifications(batchSize = 10) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_sme_debrief_notification_deliveries", {
    batch_size: batchSize,
  });
  if (error) throw error;
  const provider = new ResendNotificationProvider();
  const results = { claimed: 0, delivered: 0, failed: 0 };
  for (const delivery of (data ?? []) as Delivery[]) {
    results.claimed += 1;
    try {
      const { data: recipient, error: recipientError } = await admin.auth.admin
        .getUserById(delivery.recipient_application_user_id);
      if (recipientError || !recipient.user?.email) throw new Error("The Coordinator email address is unavailable.");
      const payload = delivery.payload;
      const projectUrl = new URL(`/sme-dashboard/projects/${payload.taskId}`, env.NEXT_PUBLIC_APP_URL);
      projectUrl.searchParams.set("sme", payload.smeWrikeUserId);
      projectUrl.searchParams.set("scope", "all");
      let attachment: { filename: string; content: string } | undefined;
      let invoiceUrl: string | undefined;
      if (payload.classification === "external" && payload.invoiceAttachmentId) {
        const { data: invoice } = await admin.from("survey_attachments")
          .select("id,original_filename,object_key").eq("id", payload.invoiceAttachmentId)
          .eq("submission_id", payload.submissionId).eq("is_active", true).maybeSingle();
        if (invoice) {
          const { data: file } = await admin.storage.from("survey-invoices").download(invoice.object_key);
          if (file) {
            attachment = {
              filename: invoice.original_filename,
              content: Buffer.from(await file.arrayBuffer()).toString("base64"),
            };
          } else {
            invoiceUrl = new URL(
              `/api/sme-management/surveys/${payload.submissionId}/invoice/${invoice.id}/download`,
              env.NEXT_PUBLIC_APP_URL,
            ).toString();
          }
        }
      }
      const lines = [
        `SME: ${payload.smeName}`,
        `SME type: ${payload.classification === "internal" ? "Internal SME" : "External SME"}`,
        `Course: ${payload.courseTitle}`,
        `Reporting Year: ${payload.reportingYear}`,
        `Project status: ${payload.projectStatus}`,
        `Submitted: ${new Date(payload.submittedAt).toLocaleString("en-US")}`,
      ];
      if (payload.classification === "external") {
        lines.push(`Billable hours: ${Number(payload.billableHours ?? 0).toFixed(2)}`);
        lines.push(`Invoiced amount: ${currency(Number(payload.invoicedAmount ?? 0))}`);
        if (invoiceUrl) lines.push(`Authenticated invoice download: ${invoiceUrl}`);
      }
      lines.push(`Secure project reference: ${projectUrl}`);
      const text = lines.join("\n");
      const html = `<h1>SME debrief received</h1><dl>${lines.slice(0, -1).map((line) => {
        const [label, ...rest] = line.split(": ");
        return `<dt><strong>${escapeHtml(label)}</strong></dt><dd>${escapeHtml(rest.join(": "))}</dd>`;
      }).join("")}</dl><p><a href="${escapeHtml(projectUrl)}">Open the secure SME project view</a></p>${
        invoiceUrl ? `<p><a href="${escapeHtml(invoiceUrl)}">Download invoice after signing in</a></p>` : ""
      }`;
      const sent = await provider.send({
        to: recipient.user.email,
        subject: `SME debrief received: ${payload.courseTitle}`,
        text,
        html,
        attachments: attachment ? [attachment] : undefined,
        idempotencyKey: delivery.delivery_id,
      });
      await admin.rpc("complete_sme_debrief_notification_delivery", {
        target_delivery_id: delivery.delivery_id,
        delivered: true,
        provider_id: sent.providerMessageId,
        failure_message: null,
        configuration_failure: false,
      });
      results.delivered += 1;
    } catch (reason) {
      const configurationFailure = reason instanceof NotificationConfigurationError;
      await admin.rpc("complete_sme_debrief_notification_delivery", {
        target_delivery_id: delivery.delivery_id,
        delivered: false,
        provider_id: null,
        failure_message: reason instanceof Error ? reason.message : "Notification delivery failed.",
        configuration_failure: configurationFailure,
      });
      results.failed += 1;
    }
  }
  return results;
}

export async function cleanupQueuedPrivateObjects(batchSize = 25) {
  const admin = createAdminClient();
  const { data: rows } = await admin.from("private_object_deletion_queue")
    .select("id,bucket,object_key,attempt_count").in("status", ["pending", "failed"])
    .lte("next_attempt_at", new Date().toISOString()).order("created_at").limit(batchSize);
  let completed = 0;
  for (const row of rows ?? []) {
    await admin.from("private_object_deletion_queue").update({
      status: "processing", attempt_count: row.attempt_count + 1,
    }).eq("id", row.id);
    const { error } = await admin.storage.from(row.bucket).remove([row.object_key]);
    await admin.from("private_object_deletion_queue").update(error ? {
      status: "failed", last_error: error.message,
      next_attempt_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    } : {
      status: "completed", last_error: null, completed_at: new Date().toISOString(),
    }).eq("id", row.id);
    if (!error) completed += 1;
  }
  return { claimed: rows?.length ?? 0, completed };
}

