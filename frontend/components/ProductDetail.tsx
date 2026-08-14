"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { User as FirebaseUser } from "firebase/auth";

import { formatPrice, mediaUrl } from "@/lib/publicApi";
import { observeAuthState } from "@/lib/firebase";
import {
  fetchMyBid,
  fetchBidSummary,
  fetchProduct,
  placeBid,
  reserveProduct,
  withdrawBid,
} from "@/lib/products";
import type { Bid, BidSummary, ProductDetail as ProductDetailData, ProductStatus } from "@/types";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";
import { ProductDetailSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { RatingBadge } from "@/components/ui/Rating";

const STATUS_BADGE: Record<ProductStatus, { label: string; cls: string }> = {
  active: { label: "Active", cls: "badge-success" },
  reserved: { label: "Reserved", cls: "badge-warning" },
  sold: { label: "Sold", cls: "badge-neutral" },
  removed: { label: "Removed", cls: "badge-neutral" },
};

export function ProductDetail({
  initial = null,
}: {
  /** Server-rendered product data; the client skips its initial fetch when present. */
  initial?: { productDetail: ProductDetailData; bidSummary: BidSummary | null } | null;
}) {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { toast } = useToast();
  const hydrated = useRef(false);

  const [data, setData] = useState<ProductDetailData | null>(initial?.productDetail ?? null);
  const [summary, setSummary] = useState<BidSummary | null>(initial?.bidSummary ?? null);
  const [myBid, setMyBid] = useState<Bid | null>(null);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [selectedImage, setSelectedImage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(
    initial?.bidSummary?.highestBid ? String(initial.bidSummary.highestBid) : "",
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return observeAuthState((nextUser) => {
      setUser(nextUser);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // Server already rendered this product — skip the duplicate fetch.
      if (!hydrated.current && initial?.productDetail) {
        hydrated.current = true;
        return;
      }
      hydrated.current = true;
      setError(null);
      setData(null);
      try {
        const res = await fetchProduct(id);
        if (cancelled) return;
        setData(res);
        const bidSummary = res.product.isBiddingEnabled
          ? await fetchBidSummary(id)
          : null;
        if (cancelled) return;
        setSummary(bidSummary);
        setAmount(bidSummary?.highestBid ? String(bidSummary.highestBid) : "");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.message.includes("404")) {
          setError("Product not found.");
        } else {
          setError(err instanceof Error ? err.message : "Failed to load product");
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [id, initial]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!user || !data?.product.isBiddingEnabled) {
        setMyBid(null);
        return;
      }
      try {
        const bid = await fetchMyBid(data.product.id);
        if (!cancelled) setMyBid(bid);
      } catch {
        if (!cancelled) setMyBid(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [user, data]);

  const handleSubmitBid = async () => {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const bid = await placeBid(data.product.id, Number(amount));
      setMyBid(bid);
      const bidSummary = await fetchBidSummary(data.product.id);
      setSummary(bidSummary);
      toast({
        title: myBid ? "Offer updated" : "Offer placed",
        description: `${formatPrice(bid.amount, bid.currency)} is your offer on ${data.product.title}.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to place offer");
    } finally {
      setBusy(false);
    }
  };

  const handleWithdraw = async () => {
    if (!data || !myBid) return;
    setBusy(true);
    setError(null);
    try {
      await withdrawBid(myBid.id);
      setMyBid(null);
      const bidSummary = await fetchBidSummary(data.product.id);
      setSummary(bidSummary);
      toast({ title: "Offer withdrawn", variant: "info" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to withdraw offer");
    } finally {
      setBusy(false);
    }
  };

  const handleBuyNow = async () => {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const { product, checkout } = await reserveProduct(data.product.id);
      setData((prev) => (prev ? { ...prev, product } : prev));
      toast({
        title: "Reserved for you",
        description: "The item is held for 15 minutes while you pay.",
      });
      router.push(
        `/checkout/${checkout.productId}?amount=${encodeURIComponent(checkout.amount)}&currency=${encodeURIComponent(checkout.currency)}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reserve product");
      setBusy(false);
    }
  };

  if (error && !data) {
    return (
      <div className="container-page py-16">
        <EmptyState
          icon="search"
          title="Product not found"
          description={error}
        >
          <Link href="/explore" className="btn btn-secondary">
            Back to Explore
          </Link>
        </EmptyState>
      </div>
    );
  }

  if (!data) {
    return <ProductDetailSkeleton />;
  }

  const { product, seller } = data;
  const image = product.images[selectedImage];
  const isOwn = user !== null && product.sellerId === user.uid;
  const isBuyable = product.status === "active" && !product.isBiddingEnabled && !isOwn;
  const isBiddable = product.status === "active" && product.isBiddingEnabled && !isOwn;
  const reservedByMe =
    product.status === "reserved" && user !== null && product.reservedBy === user.uid;
  const statusMeta = STATUS_BADGE[product.status];

  return (
    <div className="container-page py-8 sm:py-12">
      <div className="grid gap-8 lg:grid-cols-2">
        {/* Gallery */}
        <div className="fade-in-up">
          <div className="relative aspect-square w-full overflow-hidden card">
            {image ? (
              <Image
                src={mediaUrl(image)}
                alt={product.title}
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                priority
                className="object-cover"
              />
            ) : (
              <div className="flex size-full items-center justify-center text-secondary">
                No image
              </div>
            )}
          </div>
          {product.images.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {product.images.map((key, index) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedImage(index)}
                  aria-label={`View image ${index + 1}`}
                  className={cn(
                    "relative shrink-0 overflow-hidden rounded-card border-2 transition-colors",
                    index === selectedImage ? "border-accent" : "border-border opacity-70 hover:opacity-100",
                  )}
                >
                  <Image src={mediaUrl(key)} alt="" width={64} height={64} className="size-16 object-cover" />
                </button>
              ))}
            </div>
          )}
          {product.videoUrl && (
            <video
              src={mediaUrl(product.videoUrl)}
              controls
              className="mt-3 w-full rounded-card border border-border bg-surface"
            />
          )}
        </div>

        {/* Details */}
        <div className="flex flex-col gap-5">
          <div>
            <div className="flex flex-wrap gap-2">
              {product.status !== "active" && (
                <span className={cn("badge", statusMeta.cls)}>{statusMeta.label}</span>
              )}
              {product.isBiddingEnabled && <span className="badge badge-info">Bidding</span>}
              {product.isNegotiable && <span className="badge badge-neutral">Negotiable</span>}
              <span className="badge badge-neutral">{product.category}</span>
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {product.title}
            </h1>
            <div className="mt-2 flex items-baseline gap-3">
              <p className="text-3xl font-semibold tracking-tight text-foreground">
                {formatPrice(product.priceAmount, product.priceCurrency)}
              </p>
              <p className="text-sm text-muted">asking price</p>
            </div>
            {product.conditionNote && (
              <p className="mt-2 text-sm leading-6 text-secondary">{product.conditionNote}</p>
            )}
          </div>

          {/* Action panel */}
          <div className="card p-5">
            {isOwn ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-secondary">This is your listing.</p>
                <Link
                  href={`/sell/my-listings/${product.id}/bids`}
                  className="btn btn-primary w-full"
                >
                  Manage offers
                </Link>
              </div>
            ) : reservedByMe ? (
              <Link
                href={`/checkout/${product.id}?amount=${encodeURIComponent(product.priceAmount)}&currency=${encodeURIComponent(product.priceCurrency)}`}
                className="btn btn-primary w-full"
              >
                Continue to checkout
              </Link>
            ) : isBuyable ? (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleBuyNow}
                  disabled={busy}
                  className="btn btn-primary w-full"
                >
                  {busy ? "Reserving..." : "Buy now"}
                </button>
                <p className="text-xs text-muted">
                  Reserves the item for you for 15 minutes while you pay.
                </p>
              </div>
            ) : isBiddable ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
                  <p className="text-sm text-secondary">
                    {summary && summary.bidCount > 0 ? "Highest offer" : "No offers yet"}
                  </p>
                  <div className="text-right">
                    {summary && summary.bidCount > 0 ? (
                      <p className="text-lg font-semibold text-accent-strong">
                        {formatPrice(summary.highestBid ?? 0, summary.currency)}
                      </p>
                    ) : (
                      <p className="text-sm text-muted">
                        Be the first to make an offer
                      </p>
                    )}
                    {summary && summary.bidCount > 0 && (
                      <p className="text-xs text-muted">
                        {summary.bidCount} offer{summary.bidCount === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                </div>

                {user ? (
                  <div className="flex flex-col gap-2">
                    <label className="field-label">
                      Your offer ({product.priceCurrency})
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="1"
                        step="any"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="field w-full"
                        placeholder={`e.g. ${product.priceAmount}`}
                      />
                      <button
                        type="button"
                        onClick={handleSubmitBid}
                        disabled={busy || !amount || Number(amount) <= 0}
                        className="btn btn-primary shrink-0"
                      >
                        {myBid ? "Update" : "Offer"}
                      </button>
                    </div>
                    {myBid && (
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-secondary">
                          Your current offer:{" "}
                          <span className="font-semibold text-foreground">
                            {formatPrice(myBid.amount, myBid.currency)}
                          </span>
                        </p>
                        <button
                          type="button"
                          onClick={handleWithdraw}
                          disabled={busy}
                          className="btn btn-danger-ghost h-8 px-3 text-sm"
                        >
                          Withdraw
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <Link href="/" className="btn btn-secondary w-full">
                    Sign in to make an offer
                  </Link>
                )}
              </div>
            ) : (
              <p className="text-sm text-secondary">This item is no longer available.</p>
            )}

            {error && <p className="mt-3 text-sm text-danger">{error}</p>}
          </div>

          <section className="card p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Description
            </h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-secondary">
              {product.description}
            </p>
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Delivery
            </h2>
            <p className="mt-2 text-sm text-secondary">
              {product.deliveryFee > 0 ? (
                <>
                  {formatPrice(product.deliveryFee, product.priceCurrency)} —{" "}
                  {product.deliveryFeePayer === "seller"
                    ? "paid by the seller"
                    : "paid by the buyer"}
                </>
              ) : (
                "Free delivery"
              )}
            </p>
          </section>

          <section className="card flex items-center gap-3 p-5">
            {seller.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={seller.photoUrl}
                alt=""
                className="size-11 rounded-full border border-border"
              />
            ) : (
              <div className="size-11 rounded-full bg-accent-soft" />
            )}
            <div>
              <p className="text-sm font-medium text-foreground">{seller.name}</p>
              <RatingBadge avgRating={seller.avgRating} ratingCount={seller.ratingCount} className="mt-1" />
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <p className="text-xs text-muted">Seller</p>
                {seller.verificationStatus === "verified" && (
                  <span className="badge badge-success" title="Identity document approved">
                    Verified
                  </span>
                )}
                {seller.phoneVerified && (
                  <span className="badge badge-neutral" title="Phone number confirmed by OTP">
                    Phone verified
                  </span>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
