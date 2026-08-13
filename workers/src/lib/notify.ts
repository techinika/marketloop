// In-app notification creation, shared by every trigger site
// (bids, webhooks, escrow release, cron auto-refund, admin actions).

import { firestoreFromEnv, type FirestoreEnv } from "./firestore";
import { collections, type Notification } from "../models";

export interface NotificationRelatedIds {
  orderId?: string | null;
  productId?: string | null;
}

/** Creates one in-app notification for a user. Never throws for storage hiccups. */
export async function createNotification(
  env: FirestoreEnv,
  userId: string,
  type: string,
  title: string,
  message: string,
  related: NotificationRelatedIds = {},
): Promise<void> {
  try {
    const db = firestoreFromEnv(env);
    await db.createDoc<Notification>(collections.notifications, undefined, {
      userId,
      type,
      title,
      message,
      relatedOrderId: related.orderId ?? null,
      relatedProductId: related.productId ?? null,
      isRead: false,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    // Notifications must never break the primary flow.
    console.error(`createNotification failed for user ${userId}:`, err);
  }
}
