export const NOTIFICATION_DELIVERY_STATUSES = [
  "pending", "processing", "delivered", "failed", "configuration_error",
] as const;
export type NotificationDeliveryStatus = typeof NOTIFICATION_DELIVERY_STATUSES[number];

export type NotificationAttachment = {
  filename: string;
  content: string;
};

export type NotificationMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: NotificationAttachment[];
  idempotencyKey: string;
};

export type NotificationResult = {
  providerMessageId: string;
};

export interface NotificationProvider {
  send(message: NotificationMessage): Promise<NotificationResult>;
}

