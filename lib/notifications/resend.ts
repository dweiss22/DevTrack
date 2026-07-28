import { env } from "@/lib/env";
import type { NotificationMessage, NotificationProvider, NotificationResult } from "@/lib/notifications/types";

export class NotificationConfigurationError extends Error {}

export class ResendNotificationProvider implements NotificationProvider {
  async send(message: NotificationMessage): Promise<NotificationResult> {
    if (!env.RESEND_API_KEY || !env.NOTIFICATION_FROM_EMAIL) {
      throw new NotificationConfigurationError(
        "Configure RESEND_API_KEY and NOTIFICATION_FROM_EMAIL to deliver SME Coordinator notifications.",
      );
    }
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
        "idempotency-key": message.idempotencyKey,
      },
      body: JSON.stringify({
        from: env.NOTIFICATION_FROM_EMAIL,
        to: [message.to],
        reply_to: env.NOTIFICATION_REPLY_TO || undefined,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments,
      }),
    });
    const payload = await response.json().catch(() => null) as { id?: string; message?: string } | null;
    if (!response.ok || !payload?.id) {
      throw new Error(payload?.message || `Resend returned HTTP ${response.status}.`);
    }
    return { providerMessageId: payload.id };
  }
}

