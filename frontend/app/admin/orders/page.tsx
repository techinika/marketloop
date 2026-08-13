"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { formatPrice } from "@/lib/api";
import { adminListOrders } from "@/lib/admin";
import type { AdminOrderRow, EscrowStatus } from "@/types";
import { cn } from "@/lib/cn";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

const STATUS_OPTIONS: Array<{ value: EscrowStatus | ""; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "pending_payment", label: "Pending payment" },
  { value: "held", label: "Held in escrow" },
  { value: "released", label: "Released" },
  { value: "refund_requested", label: "Refund requested" },
  { value: "refunded", label: "Refunded" },
  { value: "failed", label: "Failed" },
];

const STATUS_BADGE: Record<EscrowStatus, string> = {
  pending_payment: "badge-warning",
  held: "badge-info",
  released: "badge-success",
  refunded: "badge-neutral",
  refund_requested: "badge-warning",
  failed: "badge-danger",
};

function formatDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AdminOrdersPage() {
  const [rows, setRows] = useState<AdminOrderRow[]>([]);
  const [status, setStatus] = useState<EscrowStatus | "">("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await adminListOrders(status || undefined);
        if (!cancelled) setRows(data.orders);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load orders");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [status]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Orders</h1>
          <p className="mt-1 text-sm text-muted">Every escrow order. Needs-attention orders are pinned first.</p>
        </div>
        <Link href="/admin" className="btn btn-secondary">
          Back to overview
        </Link>
      </div>

      <div className="mt-6 max-w-xs">
        <label className="field-label" htmlFor="status-filter">
          Filter
        </label>
        <select
          id="status-filter"
          value={status}
          onChange={(event) => setStatus(event.target.value as EscrowStatus | "")}
          className="field w-full"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="mt-8 text-sm text-danger">{error}</p>
      ) : loading ? (
        <div className="mt-6">
          <TableSkeleton rows={6} columns={7} />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon="search"
            title="No orders match this filter"
            description="Try a different status or check back later."
          />
        </div>
      ) : (
        <div className="card mt-6 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Buyer</th>
                <th className="px-4 py-3 font-medium">Seller</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Deadline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-surface-muted">
                  <td className="px-4 py-3 text-xs text-muted">{formatDate(row.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/orders/${row.id}`}
                      className="font-medium text-accent-strong hover:underline"
                    >
                      {row.product.title}
                    </Link>
                    {row.needsAttention && (
                      <span className="badge badge-warning ml-2">Attention</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-foreground">{row.buyer.name}</p>
                    <p className="text-xs text-muted">{row.buyer.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-foreground">{row.seller.name}</p>
                    <p className="text-xs text-muted">{row.seller.email}</p>
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">
                    {formatPrice(row.totalPaid, row.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("badge", STATUS_BADGE[row.escrowStatus])}>
                      {row.escrowStatus.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{formatDate(row.deliveryDeadline)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
