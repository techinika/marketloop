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

  const now = new Date().toISOString();

  // Optimistic-concurrency loop: read the balance, validate, then CAS-debit.
  // If a concurrent withdrawal changed the doc first, re-read and re-evaluate
  // so two requests can never both pass the `amount > balance` check on the
  // same snapshot (double spend).
  let transaction: (WalletTransaction & { id: string }) | null = null;
  let casSucceeded = false;
  let debitedBalance = 0;
  for (let attempt = 0; attempt < 5 && !casSucceeded; attempt++) {
    const snapshot = await db.getDocWithTime<User>(`${collections.users}/${user.uid}`);
    if (!snapshot) return httpError(c, 404, "User profile not found");
    const { doc: profile, updateTime } = snapshot;
    const balance = profile.walletBalance ?? 0;
    if (amount > balance) {
      return httpError(c, 400, "Insufficient wallet balance");
    }

    // Single atomic commit: CAS-debit the balance AND create the debit record.
    // Both apply together or not at all, so a failed cashout restore can't
    // leave an orphan transaction either.
    const txId = crypto.randomUUID();
    const debit = {
      userId: user.uid,
      orderId: null,
      type: "debit" as const,
      amount,
      currency: "RWF" as const,
      createdAt: now,
    };
    const committed = await db.commitWithCreate<WalletTransaction>(
      `${collections.users}/${user.uid}`,
      { walletBalance: balance - amount, updatedAt: now },
      updateTime,
      collections.walletTransactions,
      debit,
      txId,
    );
    if (!committed) continue; // conflict — re-read and retry
    transaction = committed;
    debitedBalance = balance - amount;
    casSucceeded = true;
  }
  if (!casSucceeded || !transaction) {
    return httpError(c, 409, "Withdrawal conflicted with another transaction; please retry");
  }

  try {
    await paypackFromEnv(c.env).cashout(amount, phoneNumber, `withdraw-${user.uid}-${transaction.id}`);
  } catch (err) {
    // Cashout failed: atomically re-credit (an increment, so a concurrent
    // escrow release isn't clobbered) and reclassify the transaction.
    await db.incrementField(`${collections.users}/${user.uid}`, "walletBalance", amount);
    await db.updateDoc<WalletTransaction>(`${collections.walletTransactions}/${transaction.id}`, {
      type: "refund",
    });
    return c.json({
      error: err instanceof Error ? err.message : "Withdrawal failed; balance restored",
    }, 502);
  }

  return c.json({
    transaction,
    walletBalance: debitedBalance,
  });
});
