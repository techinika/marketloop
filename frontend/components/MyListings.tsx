"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { User as FirebaseUser } from "firebase/auth";

import { formatPrice, mediaUrl } from "@/lib/api";
import { observeAuthState } from "@/lib/firebase";
import { fetchMyListings, updateProduct } from "@/lib/products";
import type { Product, ProductType } from "@/types";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRowSkeleton } from "@/components/ui/Skeleton";
import { availabilityMeta } from "@/components/ExploreFeed";

const STATUS_BADGE: Record<Product["status"], { label: string; cls: string }> = {
  active: { label: "Active", cls: "badge-success" },
  reserved: { label: "Reserved", cls: "badge-warning" },
  sold: { label: "Sold", cls: "badge-neutral" },
  sold_out: { label: "Sold out", cls: "badge-neutral" },
  removed: { label: "Removed", cls: "badge-neutral" },
};

const TYPE_BADGE: Record<ProductType, { label: string; cls: string }> = {
  made_to_order: { label: "Made to order", cls: "badge-ochre" },
  ready_to_ship: { label: "Ready to ship", cls: "badge-secondary" },
};

function ReadyToShipStock({
  product,
  onUpdated,
}: {
  product: Product;
  onUpdated: (next: Product) => void;
}) {
  const { toast } = useToast();
  const [stock, setStock] = useState(String(product.quantityAvailable ?? 0));
  const [saving, setSaving] = useState(false);

  const parsed = Number(stock);
  const valid = Number.isInteger(parsed) && parsed >= 0;
  const dirty = valid && parsed !== (product.quantityAvailable ?? 0);

  const save = async () => {
    if (!valid) {
      toast({ title: "Enter a whole number", description: "Stock must be 0 or more.", variant: "error" });
      return;
    }
    setSaving(true);
    try {
      const next = await updateProduct(product.id, { quantityAvailable: parsed });
      onUpdated(next);
      setStock(String(next.quantityAvailable ?? parsed));
      toast({ title: "Stock updated", description: parsed === 0 ? "This listing now shows as sold out." : `${parsed} in stock.` });
    } catch (err) {
      toast({ title: "Couldn't update stock", description: err instanceof Error ? err.message : "Try again.", variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-xs text-muted">
        In stock
        <input
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={stock}
          onChange={(e) => setStock(e.target.value)}
          className="field w-24 py-1.5"
        />
      </label>
      <button type="button" onClick={save} disabled={saving || !dirty} className="btn btn-secondary">
        {saving ? "Saving..." : "Update stock"}
      </button>
      <span className="text-xs text-muted">0 marks the piece sold out.</span>
    </div>
  );
}

function MadeToOrderControls({
  product,
  onUpdated,
}: {
  product: Product;
  onUpdated: (next: Product) => void;
}) {
  const { toast } = useToast();
  const [capacity, setCapacity] = useState(
    product.maxConcurrentOrders === null || product.maxConcurrentOrders === undefined
      ? ""
      : String(product.maxConcurrentOrders),
  );
  const [savingCap, setSavingCap] = useState(false);
  const [toggling, setToggling] = useState(false);

  const trimmed = capacity.trim();
  const parsedCap = trimmed === "" ? null : Number(trimmed);
  const validCap = trimmed === "" || (Number.isInteger(parsedCap) && (parsedCap as number) > 0);
  const dirtyCap = validCap && parsedCap !== (product.maxConcurrentOrders ?? null);

  const accepting = product.acceptingOrders !== false;
  const open = product.currentOpenOrders ?? 0;

  const saveCapacity = async () => {
    if (!validCap) {
      toast({ title: "Enter a whole number", description: "Capacity must be 1 or more, or leave blank for unlimited.", variant: "error" });
      return;
    }
    setSavingCap(true);
    try {
      const next = await updateProduct(product.id, { maxConcurrentOrders: parsedCap });
      onUpdated(next);
      toast({ title: "Capacity updated", description: parsedCap === null ? "Now accepting unlimited orders." : `Up to ${parsedCap} open orders.` });
    } catch (err) {
      toast({ title: "Couldn't update capacity", description: err instanceof Error ? err.message : "Try again.", variant: "error" });
    } finally {
      setSavingCap(false);
    }
  };

  const toggleAccepting = async () => {
    setToggling(true);
    try {
      const next = await updateProduct(product.id, { acceptingOrders: !accepting });
      onUpdated(next);
      setCapacity(next.maxConcurrentOrders == null ? "" : String(next.maxConcurrentOrders));
      toast({ title: accepting ? "Orders paused" : "Orders resumed" });
    } catch (err) {
      toast({ title: "Couldn't change order status", description: err instanceof Error ? err.message : "Try again.", variant: "error" });
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-xs text-muted">
        Open order cap
        <input
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          placeholder="Unlimited"
          className="field w-28 py-1.5"
        />
      </label>
      <button type="button" onClick={saveCapacity} disabled={savingCap || !dirtyCap} className="btn btn-secondary">
        {savingCap ? "Saving..." : "Update cap"}
      </button>
      <span className="text-xs text-muted">
        {open} open now
      </span>
      <button type="button" onClick={toggleAccepting} disabled={toggling} className="btn btn-secondary">
        {toggling ? "Working..." : accepting ? "Pause orders" : "Resume orders"}
      </button>
    </div>
  );
}

export function MyListings() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return observeAuthState((nextUser) => {
      setUser(nextUser);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!user) {
        setProducts(null);
        return;
      }
      setError(null);
      try {
        const rows = await fetchMyListings();
        if (!cancelled) setProducts(rows);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load your listings");
        setProducts([]);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const replaceProduct = (next: Product) => {
    setProducts((prev) => (prev ? prev.map((p) => (p.id === next.id ? next : p)) : prev));
  };

  return (
    <div className="container-page max-w-3xl py-8 sm:py-12">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="heading text-2xl text-foreground sm:text-3xl">
            My listings
          </h1>
          <p className="mt-1 text-sm text-muted">Everything you&apos;ve shared on Handi.</p>
        </div>
        <Link href="/sell/new" className="btn btn-primary">
          New listing
        </Link>
      </div>

      {!user ? (
        <div className="mt-8">
          <EmptyState
            icon="inbox"
            title="Sign in to see your listings"
            description="Your pieces and their statuses will show up here."
          >
            <Link href="/" className="btn btn-primary">
              Sign in
            </Link>
          </EmptyState>
        </div>
      ) : products === null ? (
        <div className="mt-8 flex flex-col gap-4">
          <ListRowSkeleton />
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      ) : products.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon="package"
            title="Nothing shared yet"
            description="Share your first piece — it takes a few minutes and is free."
          >
            <Link href="/sell/new" className="btn btn-primary">
              Sell your craft
            </Link>
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {products.map((product) => {
            const statusMeta = STATUS_BADGE[product.status];
            const isSoldOut = product.productType === "ready_to_ship" && product.quantityAvailable === 0;
            const avail = product.status === "active" ? availabilityMeta(product) : null;
            const badgeCls = avail ? avail.cls : isSoldOut ? "badge-neutral" : statusMeta?.cls;
            const badgeText = avail ? avail.label : isSoldOut ? "Sold out" : statusMeta?.label;
            const typeMeta = product.productType ? TYPE_BADGE[product.productType] : null;
            const showRtsControls =
              product.productType === "ready_to_ship" &&
              (product.status === "active" || product.status === "sold_out");
            const showMtoControls = product.productType === "made_to_order" && product.status === "active";

            return (
              <li key={product.id} className="card p-4">
                <div className="flex items-center gap-4">
                  <Link href={`/product/${product.id}`} className="shrink-0">
                    {product.images[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={mediaUrl(product.images[0])}
                        alt=""
                        className="size-16 rounded-xl object-cover"
                      />
                    ) : (
                      <div className="flex size-16 items-center justify-center rounded-xl bg-surface-muted text-xs text-muted">
                        No image
                      </div>
                    )}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/product/${product.id}`}
                      className="block truncate text-sm font-medium text-foreground hover:underline"
                    >
                      {product.title}
                    </Link>
                    <p className="mt-1 text-base font-semibold text-foreground">
                      {formatPrice(product.priceAmount, product.priceCurrency)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {typeMeta && <span className={cn("badge", typeMeta.cls)}>{typeMeta.label}</span>}
                      <span className={cn("badge", badgeCls)}>{badgeText}</span>
                      {product.isBiddingEnabled && <span className="badge badge-info">Bidding</span>}
                    </div>
                  </div>
                  {product.isBiddingEnabled && product.status === "active" && (
                    <Link
                      href={`/sell/my-listings/${product.id}/bids`}
                      className="btn btn-secondary shrink-0"
                    >
                      Manage offers
                    </Link>
                  )}
                </div>

                {showRtsControls && (
                  <div className="mt-3 border-t border-border pt-3">
                    <ReadyToShipStock product={product} onUpdated={replaceProduct} />
                  </div>
                )}
                {showMtoControls && (
                  <div className="mt-3 border-t border-border pt-3">
                    <MadeToOrderControls product={product} onUpdated={replaceProduct} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
    </div>
  );
}
