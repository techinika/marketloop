import { apiFetch } from "@/lib/api";
import type { Notification, NotificationList } from "@/types";

/** GET /notifications — the caller's notifications, newest first. */
export async function fetchNotifications(page = 1): Promise<NotificationList> {
  return apiFetch<NotificationList>(`/notifications?page=${page}&pageSize=20`);
}

/** POST /notifications/:id/read — marks a single notification as read. */
export async function markNotificationRead(id: string): Promise<Notification> {
  const res = await apiFetch<{ notification: Notification }>(
    `/notifications/${encodeURIComponent(id)}/read`,
    { method: "POST" },
  );
  return res.notification;
}

/** POST /notifications/read-all — marks every unread notification as read. */
export async function markAllNotificationsRead(): Promise<number> {
  const res = await apiFetch<{ updated: number }>("/notifications/read-all", { method: "POST" });
  return res.updated;
}
