"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { User as FirebaseUser } from "firebase/auth";

import { formatPrice } from "@/lib/api";
import { observeAuthState } from "@/lib/firebase";
import { fetchOrder } from "@/lib/orders";
import type { Order } from "@/types";
import { cn } from "@/lib/cn";

const POLL_INTERVAL_MS = 4000;

function AwaitingPulse() {
  return (
    <div className="mt-8 flex flex-col items-center gap-4">
      <span className="relative flex size-11 items-center justify-center">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-30" />
        <span className="relative inline-flex size-4 rounded-full bg-accent" />
      </span>
      <p className="text-sm text-secondary">This usually takes a few seconds — hang tight.</p>
    </div>
  );
}

export default function CheckoutCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; OrderTrackingId?: string; OrderMerchantReference?: string }>;
}) {
  const [orderId, setOrderId] = useState<string | null>(null);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const search = await searchParams;
      if (cancelled) return;
      // Pesapal redirects back with OrderTrackingId; we locate the order by our own orderId.
      setOrderId(search.orderId ?? null);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  useEffect(() => {
    return observeAuthState((nextUser) => setUser(nextUser));
  }, []);

  // Poll the order until payment settles (IPN updates escrowStatus server-side).
  useEffect(() => {
    if (!orderId || settled || !user) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const detail = await fetchOrder(orderId);
        if (cancelled) return;
        setOrder(detail.order);
        if (detail.order.escrowStatus !== "pending_payment") {
          setSettled(true);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Waiting for payment confirmation...");
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [orderId, settled, user]);

  const success = order && (order.escrowStatus === "held" || order.escrowStatus === "released");

  return (
    <div className="container-page flex justify-center py-16">
      <div className="card w-full max-w-lg p-8 text-center">
        {!user ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Finishing up</h1>
            <p className="mt-3 text-sm text-secondary">
              <Link href="/" className="font-medium text-accent-strong underline">
                Sign in
              </Link>{" "}
              to confirm your payment.
            </p>
          </>
        ) : error && !order ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              We can&apos;t find your order
            </h1>
            <p className="mt-3 text-sm text-secondary">{error}</p>
            <Link href="/explore" className="btn btn-primary mt-8">
              Keep exploring
            </Link>
          </>
        ) : success ? (
          <>
            <span className="badge badge-success">
              <span className="size-1.5 rounded-full bg-success" />
              Payment confirmed
            </span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
              Thank you for your purchase
            </h1>
            <p className="mt-3 text-sm leading-6 text-secondary">
              {order && (
                <>
                  You paid{" "}
                  <span className="font-semibold text-foreground">
                    {formatPrice(order.totalPaid, order.currency)}
                  </span>
                  . The seller will be paid once delivery is confirmed.
                </>
              )}
            </p>
            <Link href={`/orders/${order.id}`} className="btn btn-primary mt-8">
              Track your order
            </Link>
          </>
        ) : order && order.escrowStatus === "failed" ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Payment failed
            </h1>
            <p className="mt-3 text-sm text-secondary">
              Your card payment was not completed and the item is back on the market.
            </p>
            <Link href="/explore" className="btn btn-primary mt-8">
              Keep exploring
            </Link>
          </>
        ) : (
          <>
            <span className="badge badge-accent">
              <span className="size-1.5 rounded-full bg-accent" />
              Confirming payment
            </span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
              Finishing up
            </h1>
            <p className={cn("mt-3 text-sm leading-6 text-secondary", "max-w-sm mx-auto")}>
              Your card payment is being confirmed.
            </p>
            <AwaitingPulse />
          </>
        )}
      </div>
    </div>
  );
}
