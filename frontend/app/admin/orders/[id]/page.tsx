"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { formatPrice, mediaUrl } from "@/lib/api";
import { adminFetchOrder, adminForceRelease, adminMarkRefunded } from "@/lib/admin";
import type { AdminOrderDetail, EscrowStatus } from "@/types";
import { cn } from "@/lib/cn";
import { RatingBadge } from "@/components/ui/Rating";

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

export default function AdminOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = useState<AdminOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setData(await adminFetchOrder(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load order");
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setError(null);
      try {
        const data = await adminFetchOrder(id);
        if (!cancelled) setData(data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load order");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const runAction = async (kind: "refund" | "release") => {
    if (!data) return;
    setBusy(true);
    setActionError(null);
    try {
      if (kind === "refund") {
        await adminMarkRefunded(data.order.id, note.trim());
      } else {
        if (!note.trim()) {
          setActionError("An admin note is required for a force release.");
          setBusy(false);
          return;
        }
        await adminForceRelease(data.order.id, note.trim());
      }
      setNote("");
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return (
      <div>
        <Link href="/admin/orders" className="text-sm font-medium text-accent-strong hover:underline">
          Back to orders
        </Link>
        <p className="mt-6 text-sm text-danger">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <Link href="/admin/orders" className="text-sm font-medium text-accent-strong hover:underline">
          Back to orders
        </Link>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="skeleton h-64 w-full rounded-card" />
          <div className="skeleton h-64 w-full rounded-card" />
        </div>
      </div>
    );
  }

  const { order, product, buyer, seller, transactions, messages } = data;
  const canMarkRefunded = order.escrowStatus === "refund_requested";
  const canForceRelease = order.escrowStatus === "held";

  return (
    <div>
      <Link href="/admin/orders" className="text-sm font-medium text-accent-strong hover:underline">
        Back to orders
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Order {order.id.slice(0, 8)}</h1>
        <span className={cn("badge", STATUS_BADGE[order.escrowStatus])}>
          {order.escrowStatus.replace("_", " ")}
        </span>
      </div>

      {order.hasDispute === true && (
        <div className="mt-4 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm">
          <p className="font-semibold text-danger">Dispute — under review</p>
          <p className="mt-1 text-xs leading-5 text-secondary">
            {order.disputeReason
              ? `Reported by a party: "${order.disputeReason}"`
              : "A party reported an issue with this order."}{" "}
            Funds are locked in escrow until this is resolved. Review the message thread below,
            then mark refunded or force release when the outcome is decided.
          </p>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Payment</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Agreed amount</dt>
              <dd className="font-medium text-foreground">{formatPrice(order.agreedAmount, order.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Delivery fee</dt>
              <dd className="font-medium text-foreground">{formatPrice(order.deliveryFee, order.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Fee payer</dt>
              <dd className="font-medium text-foreground capitalize">{order.deliveryFeePayer}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2">
              <dt className="font-medium text-foreground">Total paid</dt>
              <dd className="font-semibold text-foreground">{formatPrice(order.totalPaid, order.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Provider</dt>
              <dd className="font-medium text-foreground capitalize">{order.paymentProvider}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Reference</dt>
              <dd className="font-mono text-xs text-foreground">{order.paymentReference}</dd>
            </div>
            {order.buyerPhoneNumber && (
              <div className="flex justify-between">
                <dt className="text-muted">Buyer phone</dt>
                <dd className="font-medium text-foreground">{order.buyerPhoneNumber}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Timeline</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Created</dt>
              <dd className="text-foreground">{formatDate(order.createdAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Last updated</dt>
              <dd className="text-foreground">{formatDate(order.updatedAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Delivery deadline</dt>
              <dd className="font-medium text-foreground">{formatDate(order.deliveryDeadline)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Buyer confirmed</dt>
              <dd className="text-foreground">{order.buyerConfirmedDelivery ? "Yes" : "No"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Seller confirmed</dt>
              <dd className="text-foreground">{order.sellerConfirmedDelivery ? "Yes" : "No"}</dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Product</h2>
          {product ? (
            <div className="mt-3 flex gap-3">
              {product.images?.[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mediaUrl(product.images[0])}
                  alt={product.title}
                  className="h-16 w-16 rounded-lg object-cover"
                />
              )}
              <div>
                <p className="font-medium text-foreground">{product.title}</p>
                <p className="text-sm text-muted">{product.status.replace("_", " ")}</p>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">Product no longer exists.</p>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Buyer</h2>
          <div className="mt-3 text-sm">
            <p className="font-medium text-foreground">{buyer?.name ?? "Unknown"}</p>
            <p className="text-muted">{buyer?.email ?? "—"}</p>
            <p className="mt-1 text-xs text-muted">{buyer?.uid ?? ""}</p>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Seller</h2>
          <div className="mt-3 text-sm">
            <p className="font-medium text-foreground">{seller?.name ?? "Unknown"}</p>
            <p className="text-muted">{seller?.email ?? "—"}</p>
            <p className="mt-1 text-xs text-muted">{seller?.uid ?? ""}</p>
          </div>
        </section>
      </div>

      {(canMarkRefunded || canForceRelease) && (
        <section className="card mt-6 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Admin action</h2>
          <p className="mt-2 text-sm text-muted">
            {canMarkRefunded
              ? "Mark this refund_requested order as refunded (the provider refund was already issued)."
              : "Force release these escrow funds to the seller without both-party confirmation."}
          </p>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Admin note (required for force release)"
            rows={2}
            className="field mt-3 w-full bg-background"
          />
          {actionError && <p className="mt-2 text-sm text-danger">{actionError}</p>}
          <button
            type="button"
            onClick={() => runAction(canMarkRefunded ? "refund" : "release")}
            disabled={busy}
            className="btn btn-primary mt-3"
          >
            {busy ? "Working..." : canMarkRefunded ? "Mark as refunded" : "Force release"}
          </button>
        </section>
      )}

      <section className="card mt-6 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Feedback &amp; messages</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-background p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Buyer feedback (on seller)</p>
            {order.buyerFeedback ? (
              <div className="mt-2">
                <RatingBadge avgRating={order.buyerFeedback.rating} ratingCount={1} />
                {order.buyerFeedback.comment && (
                  <p className="mt-1.5 text-xs leading-5 text-secondary">&quot;{order.buyerFeedback.comment}&quot;</p>
                )}
                <p className="mt-1 text-xs text-muted">{formatDate(order.buyerFeedback.submittedAt)}</p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted">Not submitted.</p>
            )}
          </div>
          <div className="rounded-xl border border-border bg-background p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Seller feedback (on buyer)</p>
            {order.sellerFeedback ? (
              <div className="mt-2">
                <RatingBadge avgRating={order.sellerFeedback.rating} ratingCount={1} />
                {order.sellerFeedback.comment && (
                  <p className="mt-1.5 text-xs leading-5 text-secondary">&quot;{order.sellerFeedback.comment}&quot;</p>
                )}
                <p className="mt-1 text-xs text-muted">{formatDate(order.sellerFeedback.submittedAt)}</p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted">Not submitted.</p>
            )}
          </div>
        </div>

        {messages.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No messages in this thread.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {messages.map((m) => {
              const isBuyerMsg = m.senderId === order.buyerId;
              return (
                <li
                  key={m.id}
                  className={cn(
                    "rounded-2xl px-3 py-2 text-sm",
                    isBuyerMsg ? "bg-accent-soft text-foreground" : "bg-surface-muted text-foreground",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  <p className="mt-1 text-[10px] text-muted">
                    {isBuyerMsg ? buyer?.name ?? "Buyer" : seller?.name ?? "Seller"} ·{" "}
                    {formatDate(m.createdAt)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card mt-6 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Wallet transactions</h2>
        {transactions.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No wallet transactions linked to this order.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {transactions.map((tx) => (
              <li key={tx.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <p className="font-medium capitalize text-foreground">
                    {tx.type === "credit" ? "Credit" : tx.type === "refund" ? "Refund" : "Debit"}
                  </p>
                  <p className="text-xs text-muted">{formatDate(tx.createdAt)}</p>
                </div>
                <p className={cn("font-medium", tx.type === "debit" ? "text-foreground" : "text-success")}>
                  {tx.type === "debit" ? "−" : "+"}
                  {formatPrice(tx.amount, tx.currency)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
