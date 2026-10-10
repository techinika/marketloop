import { apiFetch } from "@/lib/api";
import type { CanConfirmResponse, CustomizationResponse, DashboardOrder, MessageListResponse, Order, OrderDetail, PaymentPlan } from "@/types";

/**
 * POST /orders — starts payment for the caller's reservation on a product.
 * RWF returns immediately (Paypack cashin is initiated); USD returns a
 * Pesapal redirect_url the browser should navigate to. For made-to-order
 * pieces the caller can pick the payment plan and answer the artisan's
 * customization questions (with an optional reference image + brief).
 */
export async function createOrder(
  productId: string,
  opts: {
    phoneNumber?: string;
    paymentPlan?: PaymentPlan;
    /** Units to buy (ready-to-ship only; 1 for made-to-order). */
    quantity?: number;
    customizationResponses?: CustomizationResponse[];
    referenceImageUrl?: string;
    customRequestNote?: string;
  } = {},
): Promise<{ order: Order; redirectUrl?: string }> {
  return apiFetch<{ order: Order; redirectUrl?: string }>("/orders", {
    method: "POST",
    body: JSON.stringify({
      productId,
      ...(opts.phoneNumber ? { phoneNumber: opts.phoneNumber } : {}),
      ...(opts.paymentPlan ? { paymentPlan: opts.paymentPlan } : {}),
      ...(opts.quantity ? { quantity: opts.quantity } : {}),
      ...(opts.customizationResponses?.length ? { customizationResponses: opts.customizationResponses } : {}),
      ...(opts.referenceImageUrl ? { referenceImageUrl: opts.referenceImageUrl } : {}),
      ...(opts.customRequestNote ? { customRequestNote: opts.customRequestNote } : {}),
    }),
  });
}

/**
 * POST /orders/:id/mark-ready — the artisan finished the piece. Deposit
 * orders move to "awaiting_final_payment" so the buyer can pay the balance;
 * prepaid orders move straight to "awaiting_delivery".
 */
export async function markOrderReady(orderId: string): Promise<Order> {
  const res = await apiFetch<{ order: Order }>(
    `/orders/${encodeURIComponent(orderId)}/mark-ready`,
    { method: "POST" },
  );
  return res.order;
}

/**
 * POST /orders/:id/pay-final — the buyer pays the remaining balance once the
 * piece is marked ready (deposit plan). RWF returns immediately; USD returns
 * a Pesapal redirect_url.
 */
export async function payFinal(
  orderId: string,
  phoneNumber?: string,
): Promise<{ order: Order; redirectUrl?: string }> {
  return apiFetch<{ order: Order; redirectUrl?: string }>(
    `/orders/${encodeURIComponent(orderId)}/pay-final`,
    { method: "POST", body: JSON.stringify(phoneNumber ? { phoneNumber } : {}) },
  );
}

/**
 * POST /orders/:id/request-cancellation — the buyer asks to cancel while the
 * piece is in production. The artisan then accepts or rejects.
 */
export async function requestCancellation(orderId: string, reason: string): Promise<Order> {
  const res = await apiFetch<{ order: Order }>(
    `/orders/${encodeURIComponent(orderId)}/request-cancellation`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
  return res.order;
}

/**
 * POST /orders/:id/respond-cancellation — the artisan's verdict on the
 * pending request. Accept splits the escrow (they keep 25% of the total);
 * reject means production continues.
 */
export async function respondCancellation(orderId: string, accept: boolean): Promise<Order> {
  const res = await apiFetch<{ order: Order }>(
    `/orders/${encodeURIComponent(orderId)}/respond-cancellation`,
    { method: "POST", body: JSON.stringify({ accept }) },
  );
  return res.order;
}

/** GET /orders/:id — buyer/artisan only; used for polling after payment. */
export async function fetchOrder(orderId: string): Promise<OrderDetail> {
  return apiFetch<OrderDetail>(`/orders/${encodeURIComponent(orderId)}`);
}

/**
 * POST /orders/:id/confirm-delivery — records the caller's confirmation plus
 * feedback. `received: true` requires a 1-5 `rating` (and optional `comment`);
 * `received: false` requires a `comment` explaining the issue and flags the
 * order as a dispute for admin review.
 */
export async function confirmDelivery(
  orderId: string,
  body: { received: boolean; rating?: number; comment?: string },
): Promise<{ order: Order; disputed?: boolean }> {
  return apiFetch<{ order: Order; disputed?: boolean }>(
    `/orders/${encodeURIComponent(orderId)}/confirm-delivery`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

/** GET /orders/:id/can-confirm — whether the caller may still confirm. */
export async function fetchCanConfirm(orderId: string): Promise<CanConfirmResponse> {
  return apiFetch<CanConfirmResponse>(`/orders/${encodeURIComponent(orderId)}/can-confirm`);
}

/** GET /orders/:id/messages — the thread, oldest first. */
export async function fetchOrderMessages(orderId: string, opts?: { before?: string; limit?: number }): Promise<MessageListResponse> {
  const params = new URLSearchParams();
  if (opts?.before) params.set("before", opts.before);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.size > 0 ? `?${params.toString()}` : "";
  return apiFetch<MessageListResponse>(`/orders/${encodeURIComponent(orderId)}/messages${qs}`);
}

/** POST /orders/:id/messages — send a message in the order thread. */
export async function sendOrderMessage(orderId: string, text: string): Promise<MessageListResponse["messages"][number]> {
  const res = await apiFetch<{ message: MessageListResponse["messages"][number] }>(
    `/orders/${encodeURIComponent(orderId)}/messages`,
    { method: "POST", body: JSON.stringify({ text }) },
  );
  return res.message;
}

/** POST /orders/:id/messages/read — marks the other party's messages read. */
export async function markOrderMessagesRead(orderId: string): Promise<number> {
  const res = await apiFetch<{ updated: number }>(`/orders/${encodeURIComponent(orderId)}/messages/read`, {
    method: "POST",
  });
  return res.updated;
}

/** GET /orders/mine — the caller's purchases (buying side), newest first. */
export async function fetchMyOrders(): Promise<DashboardOrder[]> {
  const res = await apiFetch<{ orders: DashboardOrder[] }>("/orders/mine");
  return res.orders;
}

/** GET /orders/sales — the caller's sales (selling side), newest first. */
export async function fetchSalesOrders(): Promise<DashboardOrder[]> {
  const res = await apiFetch<{ orders: DashboardOrder[] }>("/orders/sales");
  return res.orders;
}
