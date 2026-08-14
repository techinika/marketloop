"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { User as FirebaseUser } from "firebase/auth";

import { formatPrice, mediaUrl } from "@/lib/api";
import { observeAuthState } from "@/lib/firebase";
import { createOrder, fetchOrder } from "@/lib/orders";
import { fetchProduct } from "@/lib/products";
import type { Currency, Order, ProductDetail } from "@/types";
import { cn } from "@/lib/cn";

const PHONE_RE = /^\+?\d{9,15}$/;

type Phase = "start" | "awaiting" | "success" | "failed";

function MoMoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true">
      <rect width="7" height="12" x="2" y="6" rx="1" />
      <path d="M13 8.32a7.43 7.43 0 0 1 0 7.36" />
      <path d="M16.46 6.21a11.76 11.76 0 0 1 0 11.58" />
      <path d="M19.91 4.1a15.91 15.91 0 0 1 .01 15.8" />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true">
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}

function AwaitingPulse({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-6">
      <span className="relative flex size-9 items-center justify-center">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-30" />
        <span className="relative inline-flex size-3 rounded-full bg-accent" />
      </span>
      <div className="text-center">
        <p className="text-sm font-medium text-accent-strong">{label}</p>
        <p className="mt-0.5 text-xs text-secondary">We&apos;ll update this page automatically.</p>
      </div>
    </div>
  );
}

export default function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ amount?: string; currency?: string }>;
}) {
  return <CheckoutBody productIdPromise={params} searchParamsPromise={searchParams} />;
}

function CheckoutBody({
  productIdPromise,
  searchParamsPromise,
}: {
  productIdPromise: Promise<{ productId: string }>;
  searchParamsPromise: Promise<{ amount?: string; currency?: string }>;
}) {
  const [productId, setProductId] = useState<string | null>(null);
  const [queryAmount, setQueryAmount] = useState<number | null>(null);
  const [queryCurrency, setQueryCurrency] = useState<Currency | null>(null);

  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState<Phase>("start");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const [{ productId: pid }, search] = await Promise.all([productIdPromise, searchParamsPromise]);
      if (cancelled) return;
      setProductId(pid);
      const amount = Number(search.amount);
      setQueryAmount(Number.isFinite(amount) && amount > 0 ? amount : null);
      setQueryCurrency((search.currency as Currency | undefined) ?? null);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [productIdPromise, searchParamsPromise]);

  useEffect(() => {
    return observeAuthState((nextUser) => setUser(nextUser));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!productId) return;
      setError(null);
      try {
        const productDetail = await fetchProduct(productId);
        if (!cancelled) setDetail(productDetail);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load product");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  // Poll the order until the payment state settles (Paypack webhook → held/failed).
  useEffect(() => {
    if (phase !== "awaiting" || !order) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await fetchOrder(order.id);
        if (cancelled) return;
        setOrder(data.order);
        if (data.order.escrowStatus !== "pending_payment") {
          setPhase(data.order.escrowStatus === "failed" ? "failed" : "success");
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Waiting for payment confirmation...");
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [phase, order]);

  const isRWF = (detail?.product.priceCurrency ?? queryCurrency ?? "RWF") === "RWF";

  const startPayment = async () => {
    if (!user || !productId) return;
    if (isRWF && !PHONE_RE.test(phone.trim())) {
      setError("Enter a valid MTN MoMo / Airtel number, e.g. 0788123456");
      return;
    }
    setError(null);
    try {
      const result = await createOrder(productId, isRWF ? phone.trim() : undefined);
      setOrder(result.order);
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }
      setPhase("awaiting");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start payment");
    }
  };

  const retry = () => {
    setOrder(null);
    setPhase("start");
    setError(null);
  };

  const product = detail?.product;
  const agreedAmount = order?.agreedAmount ?? queryAmount ?? product?.priceAmount ?? 0;
  const deliveryFee = order?.deliveryFee ?? product?.deliveryFee ?? 0;
  const currency = order?.currency ?? (product?.priceCurrency ?? queryCurrency) ?? "RWF";
  const totalPaid = order?.totalPaid ?? agreedAmount + deliveryFee;

  return (
    <div className="container-page flex justify-center py-10 sm:py-16">
      <div className="card w-full max-w-lg p-6 sm:p-8">
        {!user ? (
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Checkout</h1>
            <p className="mt-3 text-sm text-secondary">
              <Link href="/" className="font-medium text-accent-strong underline">
                Sign in
              </Link>{" "}
              to complete your purchase.
            </p>
          </div>
        ) : !product ? (
          <div className="flex flex-col gap-4 py-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-4 w-full" />
            ))}
          </div>
        ) : phase === "success" || phase === "failed" ? (
          <div className="text-center">
            <span
              className={cn(
                "badge",
                phase === "success" ? "badge-success" : "badge-danger",
              )}
            >
              <span className={`size-1.5 rounded-full ${phase === "success" ? "bg-success" : "bg-danger"}`} />
              {phase === "success" ? "Payment confirmed" : "Payment failed"}
            </span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
              {phase === "success" ? "Your payment is secured" : "Something went wrong"}
            </h1>
            <p className="mt-3 text-sm leading-6 text-secondary">
              {phase === "success"
                ? `The seller keeps ${formatPrice(agreedAmount, currency)} in escrow until delivery is confirmed. You can confirm delivery from your order page.`
                : "Your payment was not completed. The item is back on the market — you can try again."}
            </p>
            <div className="mt-8 flex flex-col gap-3">
              {phase === "success" && order ? (
                <Link href={`/orders/${order.id}`} className="btn btn-primary w-full">
                  Track your order
                </Link>
              ) : (
                <button type="button" onClick={retry} className="btn btn-primary w-full">
                  Try again
                </button>
              )}
              <Link href="/explore" className="btn btn-secondary w-full">
                Keep exploring
              </Link>
            </div>
          </div>
        ) : (
          <div className="fade-in-up">
            <span className="badge badge-accent">
              <span className="size-1.5 rounded-full bg-accent" />
              {phase === "awaiting" ? "Waiting for payment" : "Ready to pay"}
            </span>

            <div className="mt-5 flex items-center gap-4">
              {product.images[0] ? (
              <Image
                src={mediaUrl(product.images[0])}
                alt={product.title}
                width={56}
                height={56}
                className="size-14 rounded-xl object-cover"
              />
              ) : (
                <div className="flex size-14 items-center justify-center rounded-xl bg-surface-muted text-xs text-muted">
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
                <p className="mt-0.5 text-xs text-muted">Reserved for {user.displayName ?? "you"}</p>
              </div>
            </div>

            <dl className="mt-6 space-y-2 rounded-xl border border-border bg-background p-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-secondary">Item price</dt>
                <dd className="font-medium text-foreground">{formatPrice(agreedAmount, currency)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-secondary">Delivery</dt>
                <dd className="font-medium text-foreground">
                  {deliveryFee > 0 ? formatPrice(deliveryFee, currency) : "Free"}
                </dd>
              </div>
              <div className="flex justify-between border-t border-border pt-2">
                <dt className="font-medium text-foreground">Total</dt>
                <dd className="font-semibold text-foreground">{formatPrice(totalPaid, currency)}</dd>
              </div>
            </dl>

            {phase === "awaiting" ? (
              <div className="mt-6">
                <AwaitingPulse
                  label={isRWF ? "Waiting for your phone approval" : "Confirming your card payment"}
                />
              </div>
            ) : isRWF ? (
              <div className="mt-6">
                <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
                    <MoMoIcon />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Mobile Money</p>
                    <p className="text-xs text-muted">MTN MoMo or Airtel Money</p>
                  </div>
                </div>
                <div className="mt-4">
                  <label htmlFor="phone" className="field-label">
                    Mobile money number
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="e.g. 0788123456"
                    className="field w-full"
                  />
                  <p className="mt-2 text-xs text-muted">
                    We&apos;ll send a payment request to this number. Approve it on your phone.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={startPayment}
                  className="btn btn-primary mt-4 w-full"
                >
                  Pay {formatPrice(totalPaid, currency)}
                </button>
              </div>
            ) : (
              <div className="mt-6">
                <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-info-soft text-info">
                    <CardIcon />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Card payment</p>
                    <p className="text-xs text-muted">Visa, Mastercard, Amex — secured by Pesapal</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={startPayment}
                  className="btn btn-primary mt-4 w-full"
                >
                  Pay {formatPrice(totalPaid, currency)}
                </button>
                <p className="mt-2 text-center text-xs text-muted">
                  You&apos;ll be redirected to our secure card payment page.
                </p>
              </div>
            )}

            {error && <p className="mt-4 text-sm text-danger">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
