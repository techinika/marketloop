// Escrow settlement logic shared by the release path and the scheduled refund.
//
// Money flow (see order creation in routes/orders.ts):
//   totalPaid = agreedAmount + deliveryFee  (always charged to the buyer)
// Delivery-fee settlement at release (kept explicit — easy to get wrong):
//   * deliveryFeePayer === "buyer"  -> buyer already paid the courier fee on top of
//     the price, so the seller receives the FULL agreedAmount.
//   * deliveryFeePayer === "seller" -> the seller covers the courier out of escrow,
//     so the seller receives agreedAmount - deliveryFee.
//   sellerCredit = agreedAmount - (deliveryFeePayer === "seller" ? deliveryFee : 0)

import { firestoreFromEnv } from "./firestore";
import { createNotification } from "./notify";
import { paypackFromEnv } from "./paypack";
import { pesapalFromEnv } from "./pesapal";
import { collections, type Order, type Product, type User, type WalletTransaction } from "../models";
import type { Env } from "../types";

/** Escrow hold window between payment confirmation and required delivery confirmation. */
export const DELIVERY_DEADLINE_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * The amount a seller is entitled to out of escrow once delivery is confirmed.
 * Explicit, since the delivery-fee math is the easiest part of escrow to get wrong.
 */
export function sellerCreditFor(order: Pick<Order, "agreedAmount" | "deliveryFee" | "deliveryFeePayer">): number {
  return order.deliveryFeePayer === "seller" ? order.agreedAmount - order.deliveryFee : order.agreedAmount;
}

/**
 * Releases escrow to the seller's platform wallet. Called once when BOTH the
 * buyer and the seller have confirmed delivery.
 */
export async function releaseToSeller(
  env: Env,
  order: Order & { id: string },
): Promise<void> {
  const db = firestoreFromEnv(env);
  const now = new Date().toISOString();
  const credit = sellerCreditFor(order);

  const seller = await db.getDoc<User>(`${collections.users}/${order.sellerId}`);
  const currentBalance = seller?.walletBalance ?? 0;
  await db.updateDoc<User>(`${collections.users}/${order.sellerId}`, {
    walletBalance: currentBalance + credit,
    updatedAt: now,
  });

  await db.createDoc<WalletTransaction>(collections.walletTransactions, undefined, {
    userId: order.sellerId,
    orderId: order.id,
    type: "credit",
    amount: credit,
    currency: order.currency,
    createdAt: now,
  });

  await createNotification(
    env,
    order.sellerId,
    "escrow_released",
    "Funds released to your wallet",
    `${credit} ${order.currency} from order ${order.id} is now in your wallet.`,
    { orderId: order.id, productId: order.productId },
  );
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
export async function processExpiredOrders(env: Env): Promise<{ refunded: number; requested: number; skipped: number }> {
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
    if (order.buyerConfirmedDelivery && order.sellerConfirmedDelivery) continue;
    await createNotification(
      env,
      order.sellerId,
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
      { field: "deliveryDeadline", op: "<", value: now },
    ],
  });

  const result = { refunded: 0, requested: 0, skipped: 0 };
  for (const order of held) {
    if (order.buyerConfirmedDelivery && order.sellerConfirmedDelivery) {
      // Both confirmed — funds should already be released; never touch it here.
      result.skipped++;
      continue;
    }

    try {
      let nextStatus: Order["escrowStatus"];
      if (order.paymentProvider === "paypack") {
        if (!order.buyerPhoneNumber) {
          console.error(`Auto-refund: order ${order.id} has no buyerPhoneNumber; cannot cashout.`);
          result.skipped++;
          continue;
        }
        await paypackFromEnv(env).cashout(order.totalPaid, order.buyerPhoneNumber, order.id);
        nextStatus = "refunded";
        result.refunded++;
      } else {
        await pesapalFromEnv(env).refundRequest({
          confirmationCode: order.paymentReference,
          amount: order.totalPaid,
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
        amount: order.totalPaid,
        currency: order.currency,
        createdAt: now,
      });

      await createNotification(
        env,
        order.buyerId,
        "order_refunded",
        nextStatus === "refunded" ? "Refunded — funds returned" : "Refund requested",
        nextStatus === "refunded"
          ? `Your payment of ${order.totalPaid} ${order.currency} for order ${order.id} was refunded.`
          : `A refund of ${order.totalPaid} ${order.currency} for order ${order.id} was requested; the payment provider will finalize it.`,
        { orderId: order.id, productId: order.productId },
      );

      const product = await db.getDoc<Product>(`${collections.products}/${order.productId}`);
      if (product && product.status === "sold" && product.sellerId === order.sellerId) {
        await db.updateDoc<Product>(`${collections.products}/${order.productId}`, {
          status: "active",
          reservedBy: null,
          reservedUntil: null,
          updatedAt: now,
        });
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

  return result;
}
