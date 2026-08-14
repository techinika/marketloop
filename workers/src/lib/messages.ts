// Per-order messaging between buyer and seller, plus the running-average
// rating recompute shared by the delivery-confirmation flow.

import { firestoreFromEnv } from "./firestore";
import { collections, type Message, type User } from "../models";
import type { Env } from "../types";

const MAX_MESSAGE_LEN = 2000;

export interface ListMessagesResult {
  /** Oldest-first (standard chat order). */
  messages: Array<Message & { id: string }>;
  hasMore: boolean;
  /** Cursor for the next (older) page: the createdAt of the oldest returned message. */
  nextBefore: string | null;
}

/** Creates one message in an order thread. Returns the created message. */
export async function sendMessage(
  env: Env,
  orderId: string,
  senderId: string,
  senderRole: Message["senderRole"],
  text: string,
): Promise<Message & { id: string }> {
  const db = firestoreFromEnv(env);
  const message: Message = {
    orderId,
    senderId,
    senderRole,
    text,
    isRead: false,
    createdAt: new Date().toISOString(),
  };
  return db.createDoc<Message>(collections.messages, undefined, message);
}

export function isMessageTextValid(text: unknown): text is string {
  return typeof text === "string" && text.trim().length > 0 && text.length <= MAX_MESSAGE_LEN;
}

/**
 * Returns the most recent `limit` messages of an order thread, ordered
 * oldest-first. Pass `before` (a createdAt ISO string) to page further back
 * into the history. Fetching limit+1 tells us whether older messages exist.
 */
export async function listMessages(
  env: Env,
  orderId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<ListMessagesResult> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const db = firestoreFromEnv(env);

  const filters: Array<{ field: string; op: "==" | "<"; value: unknown }> = [
    { field: "orderId", op: "==", value: orderId },
  ];
  if (opts.before) filters.push({ field: "createdAt", op: "<", value: opts.before });

  const newestFirst = await db.queryCollection<Message>(collections.messages, {
    filters,
    orderBy: { field: "createdAt", direction: "DESCENDING" },
    limit: limit + 1,
  });

  const hasMore = newestFirst.length > limit;
  const slice = newestFirst.slice(0, limit);
  const messages = slice.reverse();

  return {
    messages,
    hasMore,
    nextBefore: messages.length > 0 ? messages[0]!.createdAt : null,
  };
}

/** Marks every message sent by the other party as read. Returns the count. */
export async function markOrderMessagesRead(
  env: Env,
  orderId: string,
  readerUid: string,
): Promise<number> {
  const db = firestoreFromEnv(env);
  const unread = await db.queryCollection<Message>(collections.messages, {
    filters: [
      { field: "orderId", op: "==", value: orderId },
      { field: "isRead", op: "==", value: false },
    ],
  });

  let updated = 0;
  const now = new Date().toISOString();
  for (const message of unread) {
    if (message.senderId === readerUid) continue;
    await db.updateDoc<Message>(`${collections.messages}/${message.id}`, {
      isRead: true,
    });
    updated++;
  }
  return updated;
}

/**
 * Running-average rating update on the rated user's doc. `rating` is 1-5.
 * round to one decimal so displayed averages stay short.
 */
export async function applyUserRating(env: Env, userId: string, rating: number): Promise<void> {
  const db = firestoreFromEnv(env);
  const user = await db.getDoc<User>(`${collections.users}/${userId}`);
  if (!user) return;

  const count = user.ratingCount ?? 0;
  const currentAvg = user.avgRating ?? null;
  const nextCount = count + 1;
  const nextAvg =
    currentAvg === null
      ? rating
      : Math.round(((currentAvg * count + rating) / nextCount) * 10) / 10;

  await db.updateDoc<User>(`${collections.users}/${userId}`, {
    avgRating: nextAvg,
    ratingCount: nextCount,
    updatedAt: new Date().toISOString(),
  });
}
