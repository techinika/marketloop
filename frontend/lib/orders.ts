import { apiFetch } from "@/lib/api";
import type { CanConfirmResponse, DashboardOrder, MessageListResponse, Order, OrderDetail } from "@/types";

/**
 * POST /orders — starts payment for the caller's reservation on a product.
 * RWF returns immediately (Paypack cashin is initiated); USD returns a
 * Pesapal redirect_url the browser should navigate to.
 */
export async function createOrder(
  productId: string,
  phoneNumber?: string,
): Promise<{ order: Order; redirectUrl?: string }> {
  return apiFetch<{ order: Order; redirectUrl?: string }>("/orders", {
    method: "POST",
    body: JSON.stringify({ productId, ...(phoneNumber ? { phoneNumber } : {}) }),
  });
}

/** GET /orders/:id — buyer/seller only; used for polling after payment. */
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
