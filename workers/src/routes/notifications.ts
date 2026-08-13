import { Hono } from "hono";

import { firestoreFromEnv } from "../lib/firestore";
import { authMiddleware } from "../middleware/auth";
import { collections, type Notification } from "../models";
import type { AppEnv } from "../types";

export const notificationRoutes = new Hono<AppEnv>();

notificationRoutes.use("*", authMiddleware);

/** GET /notifications — the caller's notifications, newest first, paginated. */
notificationRoutes.get("/", async (c) => {
  const user = c.get("user");
  const page = Math.max(1, Number(c.req.query("page") ?? "1"));
  const pageSize = Math.min(50, Math.max(1, Number(c.req.query("pageSize") ?? "20")));

  const db = firestoreFromEnv(c.env);
  const notifications = await db.queryCollection<Notification>(collections.notifications, {
    filters: [{ field: "userId", op: "==", value: user.uid }],
    orderBy: { field: "createdAt", direction: "DESCENDING" },
    offset: (page - 1) * pageSize,
    limit: pageSize,
  });

  return c.json({ notifications, page, pageSize });
});

/** POST /notifications/read-all — marks every unread notification as read. */
notificationRoutes.post("/read-all", async (c) => {
  const user = c.get("user");
  const db = firestoreFromEnv(c.env);
  const unread = await db.queryCollection<Notification>(collections.notifications, {
    filters: [
      { field: "userId", op: "==", value: user.uid },
      { field: "isRead", op: "==", value: false },
    ],
  });

  const now = new Date().toISOString();
  for (const notification of unread) {
    await db.updateDoc<Notification>(`${collections.notifications}/${notification.id}`, {
      isRead: true,
      updatedAt: now,
    });
  }
  return c.json({ updated: unread.length });
});

/** POST /notifications/:id/read — marks a single notification as read (own only). */
notificationRoutes.post("/:id/read", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing notification id" }, 400);

  const db = firestoreFromEnv(c.env);
  const notification = await db.getDoc<Notification>(`${collections.notifications}/${id}`);
  if (!notification) return c.json({ error: "Notification not found" }, 404);
  if (notification.userId !== user.uid) {
    return c.json({ error: "You can only mark your own notifications as read" }, 403);
  }

  const updated = await db.updateDoc<Notification>(`${collections.notifications}/${id}`, {
    isRead: true,
  });
  return c.json({ notification: updated });
});
