import { Hono } from "hono";

import { firestoreFromEnv, type QueryFilter } from "../lib/firestore";
import { httpError } from "../lib/http";
import { paypackFromEnv } from "../lib/paypack";
import { authMiddleware } from "../middleware/auth";
import { collections, type User, type WalletTransaction } from "../models";
import type { AppEnv } from "../types";

export const walletRoutes = new Hono<AppEnv>();

const PHONE_RE = /^\+?\d{9,15}$/;

/** GET /wallet — the caller's balance + transaction history, newest first.
 * Pass `limit` (max 100) and `before` (a createdAt cursor) to page backwards. */
walletRoutes.get("/", authMiddleware, async (c) => {
  const user = c.get("user");
  const db = firestoreFromEnv(c.env);

  const limitRaw = Number(c.req.query("limit") ?? "");
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : undefined;
  const before = c.req.query("before") ?? undefined;

  const filters: QueryFilter[] = [{ field: "userId", op: "==", value: user.uid }];
  if (before) filters.push({ field: "createdAt", op: "<", value: before });

  const profile = await db.getDoc<User>(`${collections.users}/${user.uid}`);
  const transactions = await db.queryCollection<WalletTransaction>(collections.walletTransactions, {
    filters,
    orderBy: { field: "createdAt", direction: "DESCENDING" },
    limit,
  });

  return c.json({
    walletBalance: profile?.walletBalance ?? 0,
    transactions,
    ...(limit && transactions.length === limit
      ? { nextPageToken: transactions[transactions.length - 1]!.createdAt }
      : {}),
  });
});

/**
 * POST /wallet/withdraw — RWF withdrawals via Paypack cashout to the caller's
 * MoMo number. USD withdrawals are not self-serve yet (manual/contact support).
 */
walletRoutes.post("/withdraw", authMiddleware, async (c) => {
  const user = c.get("user");

  let body: { amount?: unknown; phoneNumber?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return httpError(c, 400, "Invalid JSON body");
  }

  const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return httpError(c, 400, "amount must be a positive number");
  }
  const phoneNumber = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  if (!PHONE_RE.test(phoneNumber)) {
    return httpError(c, 400, "A valid phone number is required");
  }

  const db = firestoreFromEnv(c.env);
  const profile = await db.getDoc<User>(`${collections.users}/${user.uid}`);
  const balance = profile?.walletBalance ?? 0;
  if (amount > balance) {
    return httpError(c, 400, "Insufficient wallet balance");
  }

  const now = new Date().toISOString();
  // Debit first so a concurrent withdrawal can't double-spend the balance.
  const transaction = await db.createDoc<WalletTransaction>(collections.walletTransactions, undefined, {
    userId: user.uid,
    orderId: null,
    type: "debit",
    amount,
    currency: "RWF",
    createdAt: now,
  });
  await db.updateDoc<User>(`${collections.users}/${user.uid}`, {
    walletBalance: balance - amount,
    updatedAt: now,
  });

  try {
    await paypackFromEnv(c.env).cashout(amount, phoneNumber, `withdraw-${user.uid}-${transaction.id}`);
  } catch (err) {
    // Cashout failed: restore the balance and reclassify the transaction.
    await db.updateDoc<User>(`${collections.users}/${user.uid}`, {
      walletBalance: balance,
      updatedAt: now,
    });
    await db.updateDoc<WalletTransaction>(`${collections.walletTransactions}/${transaction.id}`, {
      type: "refund",
    });
    return c.json({
      error: err instanceof Error ? err.message : "Withdrawal failed; balance restored",
    }, 502);
  }

  return c.json({
    transaction,
    walletBalance: balance - amount,
  });
});
