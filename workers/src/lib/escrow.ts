// Escrow settlement logic shared by the release path and the scheduled refund.
//
// Money flow (see order creation in routes/orders.ts):
//   totalPaid = agreedAmount + deliveryFee  (always charged to the buyer)
// Delivery-fee settlement at release (kept explicit — easy to get wrong):
//   * deliveryFeePayer === "buyer"  -> buyer already paid the courier fee on top of
//     the price, so the artisan receives the FULL agreedAmount.
//   * deliveryFeePayer === "artisan" -> the artisan covers the courier out of escrow,
//     so the artisan receives agreedAmount - deliveryFee.
//   artisanCredit = agreedAmount - (deliveryFeePayer === "artisan" ? deliveryFee : 0)

import { firestoreFromEnv } from "./firestore";
import { adjustMadeToOrderSlots, restoreReadyToShipStock } from "./inventory";
import { createNotification } from "./notify";
import { paypackFromEnv } from "./paypack";
import { pesapalFromEnv } from "./pesapal";
import { collections, type Order, type Product, type WalletTransaction } from "../models";
import type { Env } from "../types";

/** Escrow hold window between payment confirmation and required delivery confirmation. */
export const DELIVERY_DEADLINE_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * How long the buyer has to pay the remaining balance after the artisan marks
 * the piece ready (`awaiting_final_payment`). On expiry the order is cancelled
 * and the deposit stays with the artisan.
 */
export const FINAL_PAYMENT_TIMEOUT_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The money actually sitting in escrow for an order right now. Deposit plans
 * collect in two charges, so escrow only holds what has confirmed so far.
 * Orders created before the deposit/final split have no amounts and held their
 * full total up front.
 */
export function heldAmountFor(
  order: Pick<Order, "totalPaid" | "depositAmount" | "finalAmount" | "depositPaid" | "finalPaid">,
): number {
  if (!Number.isFinite(order.depositAmount) || !Number.isFinite(order.finalAmount)) {
    return order.totalPaid; // legacy order predates the deposit/final split
  }
  const held = (order.depositPaid ? order.depositAmount : 0) + (order.finalPaid ? order.finalAmount : 0);
  return held > 0 ? held : 0;
}

/**
 * The amount a artisan is entitled to out of escrow once delivery is confirmed.
 * Explicit, since the delivery-fee math is the easiest part of escrow to get wrong.
 */
export function artisanCreditFor(order: Pick<Order, "agreedAmount" | "deliveryFee" | "deliveryFeePayer">): number {
  return order.deliveryFeePayer === "artisan" ? order.agreedAmount - order.deliveryFee : order.agreedAmount;
}

/**
 * Releases escrow to the artisan's platform wallet. Called once when BOTH the
 * buyer and the artisan have confirmed delivery (or admin force-releases).
 *
 * The release is atomic and idempotent: the `held -> released` CAS transition,
 * the wallet credit (server-side increment) and the wallet-transaction record
 * all land in a single :commit write batch. Concurrent release attempts on the
 * same order (double-click, both parties confirming at once, admin + buyer at
 * once) race on the CAS: exactly one wins and credits; the losers return false
 * and skip. Returns false when the order is no longer held (already released /
 * refunded), so callers must not fall through to a second credit.
 */
export async function releaseToArtisan(
  env: Env,
  order: Order & { id: string },
): Promise<boolean> {
  const db = firestoreFromEnv(env);
  const now = new Date().toISOString();
  const credit = artisanCreditFor(order);

  const snap = await db.getDocWithTime<Order>(`${collections.orders}/${order.id}`);
  if (!snap || snap.doc.escrowStatus !== "held") return false;

  const txId = crypto.randomUUID();
  const released = await db.commitWithCreate<WalletTransaction>(
    `${collections.orders}/${order.id}`,
    { escrowStatus: "released", updatedAt: now },
    snap.updateTime,
    collections.walletTransactions,
    {
      userId: order.artisanId,
      orderId: order.id,
      type: "credit",
      amount: credit,
      currency: order.currency,
      createdAt: now,
    },
    txId,
    credit !== 0 ? [{ path: `${collections.users}/${order.artisanId}`, field: "walletBalance", delta: credit }] : [],
  );
  if (!released) return false;

  // A completed made-to-order frees a production slot; ready-to-ship stock was
  // already deducted at payment, so nothing to do there.
  if (order.productType !== "ready_to_ship") {
    await adjustMadeToOrderSlots(env, order.productId, -1);
  }

  await createNotification(
    env,
    order.artisanId,
    "escrow_released",
    "Funds released to your wallet",
    `${credit} ${order.currency} from order ${order.id} is now in your wallet.`,
    { orderId: order.id, productId: order.productId },
  );
  return true;
}

/**
 * Scheduled auto-refund (Cron Trigger): finds orders still "held" past their
 * delivery deadline without both confirmations, pushes the money back to the
 * buyer and reverts the product to active.
 *
 * - Paypack: funds are pushed back immediately via cashout -> escrowStatus "refunded".
 * - Pesapal: only a refund *request* can be submitted (their finance team
 *   finalizes it), so escrowStatus becomes "refund_requested" and the UI
 *   surfaces that distinction.
 */
export async function processExpiredOrders(env: Env): Promise<{ refunded: number; requested: number; skipped: number; forfeited: number }> {
  const db = firestoreFromEnv(env);
  const now = new Date().toISOString();

  // Reminder: orders whose delivery deadline is within the next 24h and which
  // are not yet confirmed by both parties. Runs before the refund logic so the
  // last reminder is sent before the window closes.
  const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const approaching = await db.queryCollection<Order>(collections.orders, {
    filters: [
      { field: "escrowStatus", op: "==", value: "held" },
      { field: "deliveryDeadline", op: ">", value: now },
      { field: "deliveryDeadline", op: "<", value: in24h },
    ],
  });
  for (const order of approaching) {
    if (order.buyerConfirmedDelivery && order.artisanConfirmedDelivery) continue;
    await createNotification(
      env,
      order.artisanId,
      "delivery_deadline",
      "Delivery deadline approaching",
      `Your delivery window for order ${order.id} closes within 24h. Confirm delivery to release funds.`,
      { orderId: order.id, productId: order.productId },
    );
    await createNotification(
      env,
      order.buyerId,
      "delivery_deadline",
      "Confirm delivery to release funds",
      `Confirm delivery of your order before the deadline or the payment will be refunded.`,
      { orderId: order.id, productId: order.productId },
    );
  }

  const held = await db.queryCollection<Order>(collections.orders, {
    filters: [
      { field: "escrowStatus", op: "==", value: "held" },
      // `> ""` excludes orders whose delivery window hasn't started yet (the
      // deadline is only set once the piece is ready for delivery — an empty
      // string would otherwise sort before every ISO date and match `< now`).
      { field: "deliveryDeadline", op: ">", value: "" },
      { field: "deliveryDeadline", op: "<", value: now },
    ],
  });

  const result = { refunded: 0, requested: 0, skipped: 0, forfeited: 0 };
  for (const order of held) {
    if (order.buyerConfirmedDelivery && order.artisanConfirmedDelivery) {
      // Both confirmed — funds should already be released; never touch it here.
      result.skipped++;
      continue;
    }

    try {
      const refundAmount = heldAmountFor(order);
      if (refundAmount <= 0) {
        result.skipped++;
        continue;
      }
      let nextStatus: Order["escrowStatus"];
      if (order.paymentProvider === "paypack") {
        if (!order.buyerPhoneNumber) {
          console.error(`Auto-refund: order ${order.id} has no buyerPhoneNumber; cannot cashout.`);
          result.skipped++;
          continue;
        }
        await paypackFromEnv(env).cashout(refundAmount, order.buyerPhoneNumber, order.id);
        nextStatus = "refunded";
        result.refunded++;
      } else {
        await pesapalFromEnv(env).refundRequest({
          confirmationCode: order.paymentReference,
          amount: refundAmount,
          username: order.buyerId,
          remarks: "Auto-refund: delivery window expired before confirmation",
        });
        nextStatus = "refund_requested";
        result.requested++;
      }

      await db.createDoc<WalletTransaction>(collections.walletTransactions, undefined, {
        userId: order.buyerId,
        orderId: order.id,
        type: "refund",
        amount: refundAmount,
        currency: order.currency,
        createdAt: now,
      });

      await createNotification(
        env,
        order.buyerId,
        "order_refunded",
        nextStatus === "refunded" ? "Refunded — funds returned" : "Refund requested",
        nextStatus === "refunded"
          ? `Your payment of ${refundAmount} ${order.currency} for order ${order.id} was refunded.`
          : `A refund of ${refundAmount} ${order.currency} for order ${order.id} was requested; the payment provider will finalize it.`,
        { orderId: order.id, productId: order.productId },
      );

      const product = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
      if (order.productType === "ready_to_ship") {
        // Return the bought units to stock so the item is sellable again.
        await restoreReadyToShipStock(env, order.productId, order.quantity ?? 1);
      } else {
        // The refunded made-to-order frees a production slot.
        await adjustMadeToOrderSlots(env, order.productId, -1);
        if (product && product.status === "sold" && product.artisanId === order.artisanId) {
          await db.updateDoc<Product>(`${collections.products}/${order.productId}`, {
            status: "active",
            reservedBy: null,
            reservedUntil: null,
            updatedAt: now,
          });
        }
      }

      await db.updateDoc<Order>(`${collections.orders}/${order.id}`, {
        escrowStatus: nextStatus,
        updatedAt: now,
      });
    } catch (err) {
      // Keep the order "held" so a later cron run can retry; log for diagnostics.
      console.error(`Auto-refund failed for order ${order.id}:`, err);
      result.skipped++;
    }
  }

  // Non-payment timeout (deposit plan): the buyer had FINAL_PAYMENT_TIMEOUT_MS
  // after the artisan marked the piece ready to pay the remaining balance.
  // On expiry the order is cancelled, the deposit stays with the artisan (it is
  // released to their wallet), and the product returns to the marketplace.
  const cutoff = new Date(Date.now() - FINAL_PAYMENT_TIMEOUT_MS).toISOString();
  const awaitingFinalPayment = await db.queryCollection<Order>(collections.orders, {
    filters: [
      { field: "productionStatus", op: "==", value: "awaiting_final_payment" },
      { field: "productionStatusAt", op: "<", value: cutoff },
    ],
  });

  for (const order of awaitingFinalPayment) {
    if (order.escrowStatus !== "held" || order.productionStatus !== "awaiting_final_payment") continue;
    if (!(order.productionStatusAt < cutoff)) continue;

    try {
      const deposit = heldAmountFor(order);
      const snap = await db.getDocWithTime<Order>(`${collections.orders}/${order.id}`);
      if (
        !snap ||
        snap.doc.escrowStatus !== "held" ||
        snap.doc.productionStatus !== "awaiting_final_payment"
      ) {
        continue;
      }

      const cancelled = { escrowStatus: "released" as const, productionStatus: "cancelled_forfeited" as const, productionStatusAt: now, updatedAt: now };
      let committed: boolean;
      if (deposit > 0) {
        const created = await db.commitWithCreate<WalletTransaction>(
          `${collections.orders}/${order.id}`,
          cancelled,
          snap.updateTime,
          collections.walletTransactions,
          {
            userId: order.artisanId,
            orderId: order.id,
            type: "credit",
            amount: deposit,
            currency: order.currency,
            createdAt: now,
          },
          crypto.randomUUID(),
          [{ path: `${collections.users}/${order.artisanId}`, field: "walletBalance", delta: deposit }],
        );
        committed = created !== null;
      } else {
        const updated = await db.updateDocIf<Order>(`${collections.orders}/${order.id}`, cancelled, snap.updateTime);
        committed = updated !== null;
      }
      if (!committed) {
        result.skipped++;
        continue;
      }
      result.forfeited++;

      const product = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
      if (product && product.status === "sold" && product.artisanId === order.artisanId) {
        await db.updateDoc<Product>(`${collections.products}/${order.productId}`, {
          status: "active",
          reservedBy: null,
          reservedUntil: null,
          updatedAt: now,
        });
      }
      // The forfeited made-to-order frees a production slot.
      await adjustMadeToOrderSlots(env, order.productId, -1);

      await createNotification(
        env,
        order.buyerId,
        "order_cancelled_forfeited",
        "Order cancelled — final payment not received",
        `The remaining ${order.finalAmount} ${order.currency} for order ${order.id} wasn't paid within 3 days. The order is cancelled and the artisan keeps the ${deposit} ${order.currency} deposit.`,
        { orderId: order.id, productId: order.productId },
      );
      await createNotification(
        env,
        order.artisanId,
        "order_cancelled_forfeited",
        "Buyer missed the final payment deadline",
        `The buyer didn't pay the remaining ${order.finalAmount} ${order.currency} for order ${order.id} within 3 days. The order is cancelled and the ${deposit} ${order.currency} deposit was released to your wallet.`,
        { orderId: order.id, productId: order.productId },
      );
    } catch (err) {
      // Leave the order as-is so a later cron run can retry.
      console.error(`Final-payment forfeiture failed for order ${order.id}:`, err);
      result.skipped++;
    }
  }

  return result;
}
