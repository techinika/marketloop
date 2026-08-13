import { Hono } from "hono";

import { firestoreFromEnv } from "../lib/firestore";
import { paypackFromEnv } from "../lib/paypack";
import { authMiddleware } from "../middleware/auth";
import { collections, type User, type WalletTransaction } from "../models";
import type { AppEnv } from "../types";

export const walletRoutes = new Hono<AppEnv>();

const PHONE_RE = /^\+?\d{9,15}$/;

/** GET /wallet — the caller's balance + transaction history. */
walletRoutes.get("/", authMiddleware, async (c) => {
  const user = c.get("user");
  const db = firestoreFromEnv(c.env);

  const profile = await db.getDoc<User>(`${collections.users}/${user.uid}`);
  const transactions = await db.queryCollection<WalletTransaction>(collections.walletTransactions, {
    filters: [{ field: "userId", op: "==", value: user.uid }],
    orderBy: { field: "createdAt", direction: "DESCENDING" },
  });

  return c.json({
    walletBalance: profile?.walletBalance ?? 0,
    transactions,
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
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return c.json({ error: "amount must be a positive number" }, 400);
  }
  const phoneNumber = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  if (!PHONE_RE.test(phoneNumber)) {
    return c.json({ error: "A valid phone number is required" }, 400);
  }

  const db = firestoreFromEnv(c.env);
  const profile = await db.getDoc<User>(`${collections.users}/${user.uid}`);
  const balance = profile?.walletBalance ?? 0;
  if (amount > balance) {
    return c.json({ error: "Insufficient wallet balance" }, 400);
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
