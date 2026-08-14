"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { User as FirebaseUser } from "firebase/auth";

import { formatPrice, mediaUrl } from "@/lib/api";
import { observeAuthState } from "@/lib/firebase";
import {
  confirmDelivery,
  fetchCanConfirm,
  fetchOrder,
  fetchOrderMessages,
  markOrderMessagesRead,
  sendOrderMessage,
} from "@/lib/orders";
import type { CanConfirmResponse, Message, Order, OrderDetail } from "@/types";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";
import { StepTracker } from "@/components/ui/StepTracker";
import { EmptyState } from "@/components/ui/EmptyState";
import { RatingBadge, StarRating } from "@/components/ui/Rating";

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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Delivery confirmation state
  const [canConfirm, setCanConfirm] = useState<CanConfirmResponse | null>(null);
  const [confirmStep, setConfirmStep] = useState<"idle" | "question" | "received" | "problem">("idle");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

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

  const loadOrder = useCallback(async () => {
    if (!orderId || !user) return;
    try {
      const data = await fetchOrder(orderId);
      setDetail(data);
      setError(null);
      if (data.order.escrowStatus === "held") {
        setCanConfirm(await fetchCanConfirm(orderId));
      } else {
        setCanConfirm(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load order");
    }
  }, [orderId, user]);

  const loadMessages = useCallback(async () => {
    if (!orderId || !user) return;
    try {
      const res = await fetchOrderMessages(orderId);
      setThreadError(null);
      setMessages(res.messages);
      const unreadFromOther = res.messages.some((m) => m.senderId !== user.uid && !m.isRead);
      if (unreadFromOther) {
        await markOrderMessagesRead(orderId);
        setMessages((prev) => prev.map((m) => (m.senderId !== user.uid ? { ...m, isRead: true } : m)));
      }
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : "Failed to load messages");
    }
  }, [orderId, user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    void loadOrder();
  }, [loadOrder]);

  // Chat: initial load + poll every 10s + refresh on focus.
  useEffect(() => {
    if (!orderId || !user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial thread fetch on mount
    void loadMessages();
    const interval = setInterval(() => void loadMessages(), 10_000);
    const onFocus = () => void loadMessages();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [orderId, user, loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  const remaining = useCountdown(detail?.order.deliveryDeadline ?? "");

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !orderId || sending) return;
    setSending(true);
    setThreadError(null);
    try {
      const message = await sendOrderMessage(orderId, text);
      setMessages((prev) => [...prev, message]);
      setDraft("");
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const handleConfirm = async () => {
    if (!detail || !orderId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await confirmDelivery(
        orderId,
        confirmStep === "received" ? { received: true, rating, comment: comment.trim() || undefined } : { received: false, comment },
      );
      if (res.disputed) {
        toast({
          title: "Issue reported",
          description: "Your report is with our support team. Funds stay locked while it's reviewed.",
          variant: "info",
        });
      } else {
        const released = res.order.escrowStatus === "released";
        toast({
          title: released ? "Escrow released" : "Delivery confirmed",
          description: released
            ? "Funds have been released to the seller."
            : "Thanks — we're waiting on the other party's confirmation and feedback too.",
        });
      }
      setConfirmStep("idle");
      setComment("");
      setRating(5);
      await loadOrder();
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
  const hasDispute = order.hasDispute === true;
  const otherParty = isBuyer ? seller : buyer;
  const counterpartRole = isBuyer ? "seller" : "buyer";
  const myFeedback = isBuyer ? order.buyerFeedback : order.sellerFeedback;
  const feedbackAboutMe = isBuyer ? order.sellerFeedback : order.buyerFeedback;
  const showConfirmUi =
    (isBuyer || isSeller) && order.escrowStatus === "held" && !hasDispute;
  const canConfirmNow = showConfirmUi && canConfirm?.allowed === true && !busy;

  return (
    <div className="container-page max-w-2xl py-10 sm:py-14">
      <div className="card p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Order {order.id.slice(0, 8)}
        </h1>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("badge", meta.cls)}>{meta.label}</span>
            {hasDispute && <span className="badge badge-danger">Under review</span>}
          </div>
          {order.escrowStatus === "held" && !hasDispute && (
            <span className="text-xs text-muted">
              Delivery window: <span className="font-medium text-foreground">{remaining}</span> left
            </span>
          )}
        </div>

        <div className="mt-6">
          <StepTracker order={order} />
        </div>

        {hasDispute && (
          <div className="mt-5 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm">
            <p className="font-semibold text-danger">This order is under review</p>
            <p className="mt-1 text-xs leading-5 text-secondary">
              {order.disputeReason
                ? `Reported issue: "${order.disputeReason}"`
                : "An issue was reported with this order."}{" "}
              Funds are locked in escrow and our support team is reviewing it. You&apos;ll be notified
              when it&apos;s resolved.
            </p>
          </div>
        )}

        {product && (
          <div className="mt-6 flex items-center gap-4">
            {product.images[0] ? (
              <Image
                src={mediaUrl(product.images[0])}
                alt={product.title}
                width={64}
                height={64}
                className="size-16 rounded-xl object-cover"
              />
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
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-foreground">Delivery confirmation</p>
              <RatingBadge avgRating={otherParty?.avgRating} ratingCount={otherParty?.ratingCount} />
            </div>

            {showConfirmUi && !hasDispute && (
              <div className="mt-3">
                {confirmStep === "idle" && canConfirmNow && (
                  <div>
                    <p className="text-xs leading-5 text-secondary">
                      {isBuyer
                        ? "Have you received the item in the agreed condition?"
                        : "Have you delivered the item and had it accepted?"}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => setConfirmStep("received")}
                        className="btn btn-primary"
                      >
                        Yes — {isBuyer ? "I received it" : "I delivered it"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmStep("problem")}
                        className="btn btn-danger-ghost"
                      >
                        No — there&apos;s a problem
                      </button>
                    </div>
                  </div>
                )}

                {confirmStep === "received" && (
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-medium text-foreground">
                        Rate the {counterpartRole} (1–5 stars)
                      </p>
                      <div className="mt-2">
                        <StarRating value={rating} onChange={setRating} />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="confirm-comment" className="block text-xs font-medium text-foreground">
                        Comment (optional)
                      </label>
                      <textarea
                        id="confirm-comment"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        rows={2}
                        maxLength={2000}
                        placeholder="How was the transaction?"
                        className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted focus:border-accent"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleConfirm}
                      disabled={busy}
                      className="btn btn-primary"
                    >
                      {busy ? "Submitting..." : "Confirm & submit rating"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmStep("idle")}
                      className="btn btn-secondary ml-2"
                    >
                      Back
                    </button>
                  </div>
                )}

                {confirmStep === "problem" && (
                  <div className="space-y-3">
                    <p className="text-xs leading-5 text-secondary">
                      Please explain what went wrong. The order will be flagged for our support team
                      and funds stay locked until it&apos;s resolved.
                    </p>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={3}
                      maxLength={2000}
                      placeholder="Describe the issue (required)..."
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted focus:border-danger"
                    />
                    <button
                      type="button"
                      onClick={handleConfirm}
                      disabled={busy || comment.trim().length === 0}
                      className="btn btn-danger"
                    >
                      {busy ? "Reporting..." : "Report issue"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmStep("idle")}
                      className="btn btn-secondary ml-2"
                    >
                      Back
                    </button>
                  </div>
                )}

                {confirmStep === "idle" && !canConfirmNow && canConfirm?.reason && (
                  <p className="mt-2 text-xs text-secondary">{canConfirm.reason}</p>
                )}

                {!canConfirmNow && !canConfirm?.reason && confirmStep === "idle" && (
                  <p className="mt-2 text-xs leading-5 text-secondary">
                    {isBuyer
                      ? `You have confirmed receipt${myFeedback ? ` and rated the seller ${myFeedback.rating}/5` : ""}.`
                      : `You have confirmed delivery${myFeedback ? ` and rated the buyer ${myFeedback.rating}/5` : ""}.`}
                    {canConfirm?.otherConfirmed
                      ? " The other party has confirmed too."
                      : " Waiting for the other party to confirm and rate."}
                  </p>
                )}
              </div>
            )}

            {hasDispute && (
              <p className="mt-2 text-xs leading-5 text-secondary">
                Confirmation is paused while this order is under review.
              </p>
            )}

            {feedbackAboutMe && (order.escrowStatus === "released" || hasDispute) && (
              <div className="mt-3 flex items-center gap-2 text-xs text-secondary">
                <RatingBadge avgRating={feedbackAboutMe.rating} ratingCount={1} />
                <span>
                  {counterpartRole === "seller" ? "The seller" : "The buyer"} rated you {feedbackAboutMe.rating}/5
                </span>
              </div>
            )}
          </div>
        )}

        {/* Chat */}
        <div className="mt-6 rounded-xl border border-border bg-background">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="font-medium text-foreground">Messages</p>
            <span className="text-xs text-muted">
              {otherParty.name} · <RatingBadge avgRating={otherParty?.avgRating} ratingCount={otherParty?.ratingCount} />
            </span>
          </div>

          <div className="flex h-72 flex-col gap-2 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <p className="m-auto text-xs text-muted">
                No messages yet. Say hello — sorting out delivery details here keeps everything on
                record.
              </p>
            )}
            {messages.map((m) => {
              const mine = m.senderId === user.uid;
              return (
                <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                      mine
                        ? "rounded-br-sm bg-accent text-white"
                        : "rounded-bl-sm bg-surface-muted text-foreground",
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    <p className={cn("mt-1 text-[10px]", mine ? "text-white/70" : "text-muted")}>
                      {formatTime(m.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          <div className="border-t border-border p-3">
            {threadError && <p className="mb-2 text-xs text-danger">{threadError}</p>}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSend();
              }}
              className="flex items-end gap-2"
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                rows={1}
                maxLength={2000}
                placeholder={`Message ${otherParty.name}...`}
                className="max-h-32 min-h-[42px] flex-1 resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted focus:border-accent"
              />
              <button
                type="submit"
                disabled={sending || draft.trim().length === 0}
                className="btn btn-primary shrink-0"
              >
                {sending ? "Sending..." : "Send"}
              </button>
            </form>
          </div>
        </div>

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
          <Link href={product ? `/product/${product.id}` : "/explore"} className="btn btn-secondary">
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
