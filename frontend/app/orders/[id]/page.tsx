"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { User as FirebaseUser } from "firebase/auth";

import { formatPrice, mediaUrl } from "@/lib/api";
import { observeAuthState } from "@/lib/firebase";
import { confirmDelivery, fetchOrder } from "@/lib/orders";
import type { Order, OrderDetail } from "@/types";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";
import { StepTracker } from "@/components/ui/StepTracker";
import { EmptyState } from "@/components/ui/EmptyState";

const STATUS_BADGE: Record<Order["escrowStatus"], { label: string; cls: string }> = {
  pending_payment: { label: "Awaiting payment", cls: "badge-warning" },
  held: { label: "Paid — held in escrow", cls: "badge-info" },
  released: { label: "Escrow released", cls: "badge-success" },
  refunded: { label: "Refunded", cls: "badge-neutral" },
  refund_requested: { label: "Refund requested", cls: "badge-warning" },
  failed: { label: "Payment failed", cls: "badge-danger" },
};

function useCountdown(deadline: string): string {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    if (!deadline) {
      return;
    }
    const target = new Date(deadline).getTime();
    const tick = () => {
      const diff = target - Date.now();
      if (diff <= 0) {
        setRemaining("expired");
        return;
      }
      const days = Math.floor(diff / 86_400_000);
      const hours = Math.floor((diff % 86_400_000) / 3_600_000);
      const mins = Math.floor((diff % 3_600_000) / 60_000);
      setRemaining(
        days > 0 ? `${days}d ${hours}h ${mins}m` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`,
      );
    };
    tick();
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, [deadline]);

  return remaining;
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  return <OrderBody idPromise={params} />;
}

function OrderBody({ idPromise }: { idPromise: Promise<{ id: string }> }) {
  const { toast } = useToast();
  const [orderId, setOrderId] = useState<string | null>(null);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const { id } = await idPromise;
      if (!cancelled) setOrderId(id);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [idPromise]);

  useEffect(() => {
    return observeAuthState((nextUser) => setUser(nextUser));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!orderId || !user) return;
      setError(null);
      try {
        const data = await fetchOrder(orderId);
        if (!cancelled) setDetail(data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load order");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [orderId, user]);

  const remaining = useCountdown(detail?.order.deliveryDeadline ?? "");

  const handleConfirm = async () => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await confirmDelivery(detail.order.id);
      setDetail({ ...detail, order: updated });
      const released = updated.escrowStatus === "released";
      toast({
        title: released ? "Escrow released" : "Delivery confirmed",
        description: released
          ? "Funds have been released to the seller."
          : "Thanks — we're waiting on the other party to confirm too.",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm delivery");
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <div className="container-page py-16">
        <EmptyState
          icon="inbox"
          title="Sign in to view this order"
          description="You need to be signed in as the buyer or seller to see this order."
        >
          <Link href="/" className="btn btn-primary">
            Sign in
          </Link>
        </EmptyState>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="container-page max-w-2xl py-16">
        <div className="flex flex-col gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-16 w-full rounded-card" />
          ))}
        </div>
        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      </div>
    );
  }

  const { order, product, buyer, seller } = detail;
  const meta = STATUS_BADGE[order.escrowStatus];
  const isBuyer = user.uid === order.buyerId;
  const isSeller = user.uid === order.sellerId;
  const canConfirm = order.escrowStatus === "held" && (isBuyer || isSeller);
  const otherConfirmed =
    order.escrowStatus === "held" && (isBuyer ? order.sellerConfirmedDelivery : order.buyerConfirmedDelivery);

  return (
    <div className="container-page max-w-2xl py-10 sm:py-14">
      <div className="card p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={cn("badge", meta.cls)}>{meta.label}</span>
          {order.escrowStatus === "held" && (
            <span className="text-xs text-muted">
              Delivery window: <span className="font-medium text-foreground">{remaining}</span> left
            </span>
          )}
        </div>

        <div className="mt-6">
          <StepTracker order={order} />
        </div>

        {product && (
          <div className="mt-6 flex items-center gap-4">
            {product.images[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaUrl(product.images[0])} alt="" className="size-16 rounded-xl object-cover" />
            ) : (
              <div className="flex size-16 items-center justify-center rounded-xl bg-surface-muted text-xs text-muted">
                No image
              </div>
            )}
            <div className="min-w-0">
              <Link
                href={`/product/${product.id}`}
                className="block truncate text-sm font-medium text-foreground hover:underline"
              >
                {product.title}
              </Link>
              <p className="mt-0.5 text-xs text-muted">
                Sold by {seller.name} · Bought by {buyer.name}
              </p>
            </div>
          </div>
        )}

        <dl className="mt-6 space-y-2 rounded-xl border border-border bg-background p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-secondary">Item price</dt>
            <dd className="font-medium text-foreground">{formatPrice(order.agreedAmount, order.currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-secondary">Delivery</dt>
            <dd className="font-medium text-foreground">
              {order.deliveryFee > 0 ? formatPrice(order.deliveryFee, order.currency) : "Free"}
            </dd>
          </div>
          <div className="flex justify-between border-t border-border pt-2">
            <dt className="font-medium text-foreground">Total paid</dt>
            <dd className="font-semibold text-foreground">{formatPrice(order.totalPaid, order.currency)}</dd>
          </div>
        </dl>

        {(isBuyer || isSeller) && (
          <div className="mt-6 rounded-xl border border-border bg-background p-4 text-sm">
            <p className="font-medium text-foreground">Delivery confirmation</p>
            <p className="mt-1 text-xs leading-5 text-secondary">
              {isBuyer
                ? `You${order.buyerConfirmedDelivery ? " have" : ""} confirmed receipt${order.buyerConfirmedDelivery ? "." : ""}${
                    order.sellerConfirmedDelivery
                      ? " The seller has confirmed delivery too."
                      : " The seller hasn't confirmed yet."
                  }`
                : `You${order.sellerConfirmedDelivery ? " have" : ""} confirmed delivery${order.sellerConfirmedDelivery ? "." : ""}${
                    order.buyerConfirmedDelivery
                      ? " The buyer has confirmed receipt too."
                      : " The buyer hasn't confirmed yet."
                  }`}
            </p>
            {canConfirm && (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={busy}
                className="btn btn-primary mt-3"
              >
                {busy
                  ? "Confirming..."
                  : isBuyer
                    ? "I received the item"
                    : "I delivered the item"}
              </button>
            )}
            {canConfirm && otherConfirmed && (
              <p className="mt-2 text-xs text-accent-strong">
                The other party confirmed — escrow will release when you confirm too.
              </p>
            )}
          </div>
        )}

        {order.escrowStatus === "refund_requested" && (
          <p className="mt-5 text-sm leading-6 text-secondary">
            Your refund has been requested with the card provider and is being processed. It
            usually takes a few business days to appear on your statement.
          </p>
        )}

        {order.escrowStatus === "refunded" && (
          <p className="mt-5 text-sm leading-6 text-secondary">
            Your payment was refunded and the item is back on the market.
          </p>
        )}

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}

        <div className="mt-8 flex gap-3">
          <Link
            href={product ? `/product/${product.id}` : "/explore"}
            className="btn btn-secondary"
          >
            View product
          </Link>
          <Link href="/explore" className="btn btn-secondary">
            Keep exploring
          </Link>
        </div>
      </div>
    </div>
  );
}
