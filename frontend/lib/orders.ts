import { apiFetch } from "@/lib/api";
import type { DashboardOrder, Order, OrderDetail } from "@/types";

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

/** POST /orders/:id/confirm-delivery — records the caller's confirmation. */
export async function confirmDelivery(orderId: string): Promise<Order> {
  const res = await apiFetch<{ order: Order }>(
    `/orders/${encodeURIComponent(orderId)}/confirm-delivery`,
    { method: "POST" },
  );
  return res.order;
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
