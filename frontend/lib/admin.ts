import { apiFetch } from "@/lib/api";
import type {
  AdminOrderDetail,
  AdminOrderList,
  AdminStats,
  AdminUserList,
  Order,
} from "@/types";

/** GET /admin/orders — all orders, filterable by escrowStatus. */
export async function adminListOrders(status?: string, page = 1): Promise<AdminOrderList> {
  const query = new URLSearchParams({ page: String(page), pageSize: "50" });
  if (status) query.set("status", status);
  return apiFetch<AdminOrderList>(`/admin/orders?${query.toString()}`);
}

/** GET /admin/orders/:id — full detail + linked wallet transactions. */
export async function adminFetchOrder(id: string): Promise<AdminOrderDetail> {
  return apiFetch<AdminOrderDetail>(`/admin/orders/${encodeURIComponent(id)}`);
}

/** POST /admin/orders/:id/mark-refunded — admin confirms a provider refund. */
export async function adminMarkRefunded(id: string, adminNote: string): Promise<Order> {
  const res = await apiFetch<{ order: Order }>(
    `/admin/orders/${encodeURIComponent(id)}/mark-refunded`,
    { method: "POST", body: JSON.stringify({ adminNote }) },
  );
  return res.order;
}

/** POST /admin/orders/:id/force-release — releases held funds without both-party confirmation. */
export async function adminForceRelease(id: string, adminNote: string): Promise<Order> {
  const res = await apiFetch<{ order: Order }>(
    `/admin/orders/${encodeURIComponent(id)}/force-release`,
    { method: "POST", body: JSON.stringify({ adminNote }) },
  );
  return res.order;
}

/** GET /admin/users — paginated user list with listing/order counts. */
export async function adminListUsers(search = "", page = 1): Promise<AdminUserList> {
  const query = new URLSearchParams({ page: String(page), pageSize: "50" });
  if (search) query.set("search", search);
  return apiFetch<AdminUserList>(`/admin/users?${query.toString()}`);
}

/** GET /admin/stats — marketplace health + monthly GMV. */
export async function adminFetchStats(): Promise<AdminStats> {
  return apiFetch<AdminStats>("/admin/stats");
}
