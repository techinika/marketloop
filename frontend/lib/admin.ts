import { apiFetch } from "@/lib/api";
import type {
  AdminOrderDetail,
  AdminOrderList,
  AdminStats,
  AdminUserList,
  AdminVerificationList,
  AdminVerificationRow,
  Order,
  User,
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

/** GET /admin/verifications/pending — identity submissions awaiting review. */
export async function adminListPendingVerifications(): Promise<AdminVerificationList> {
  return apiFetch<AdminVerificationList>("/admin/verifications/pending");
}

/** POST /admin/verifications/:uid/approve — approve an identity submission. */
export async function adminApproveVerification(uid: string): Promise<User> {
  const res = await apiFetch<{ user: User }>(
    `/admin/verifications/${encodeURIComponent(uid)}/approve`,
    { method: "POST" },
  );
  return res.user;
}

/** POST /admin/verifications/:uid/reject — reject with a reason shown to the user. */
export async function adminRejectVerification(uid: string, reason: string): Promise<User> {
  const res = await apiFetch<{ user: User }>(
    `/admin/verifications/${encodeURIComponent(uid)}/reject`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
  return res.user;
}

export type { AdminVerificationRow };
