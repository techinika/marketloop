import { cn } from "@/lib/cn";

/** Base shimmer block. Compose into shape-matching skeletons. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

/** Skeleton product card — matches the Explore grid card shape. */
export function ProductCardSkeleton() {
  return (
    <div className="card overflow-hidden">
      <Skeleton className="aspect-square w-full rounded-none" />
      <div className="space-y-2.5 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

/** Skeleton row — matches list rows on bids/listings/orders/dashboard. */
export function ListRowSkeleton() {
  return (
    <div className="card flex items-center gap-4 p-4">
      <Skeleton className="size-16 shrink-0 rounded-card" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-5 w-1/5" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-9 w-24 shrink-0 rounded-xl" />
    </div>
  );
}

/** Skeleton table body — mirrors admin table rows. */
export function TableSkeleton({ rows = 6, columns = 7 }: { rows?: number; columns?: number }) {
  return (
    <tbody className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex}>
          {Array.from({ length: columns }).map((_, colIndex) => (
            <td key={colIndex} className="px-4 py-3.5">
              <Skeleton className="h-4 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

/** Skeleton product detail — main gallery block + sticky info column. */
export function ProductDetailSkeleton() {
  return (
    <div className="container-page grid gap-8 py-8 lg:grid-cols-2">
      <div className="space-y-3">
        <Skeleton className="aspect-square w-full rounded-card" />
        <div className="flex gap-2">
          <Skeleton className="size-16 rounded-card" />
          <Skeleton className="size-16 rounded-card" />
          <Skeleton className="size-16 rounded-card" />
        </div>
      </div>
      <div className="space-y-5">
        <div className="space-y-2">
          <Skeleton className="h-3 w-1/4" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-10 w-1/3" />
        </div>
        <Skeleton className="h-40 w-full rounded-card" />
        <Skeleton className="h-24 w-full rounded-card" />
        <Skeleton className="h-16 w-full rounded-card" />
      </div>
    </div>
  );
}

/** Whole-page skeleton for the Explore feed (loading.tsx fallback). */
export function ExploreSkeleton() {
  return (
    <div className="container-page py-8 sm:py-12">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-32 rounded-full" />
        <Skeleton className="ml-auto h-10 w-56 rounded-full sm:w-64" />
        <Skeleton className="h-10 w-40 rounded-full" />
        <Skeleton className="h-10 w-28 rounded-full" />
        <Skeleton className="h-10 w-40 rounded-full" />
        <Skeleton className="h-10 w-32 rounded-full" />
      </div>
      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <ProductCardSkeleton />
        <ProductCardSkeleton />
        <ProductCardSkeleton />
        <ProductCardSkeleton />
        <ProductCardSkeleton />
        <ProductCardSkeleton />
      </div>
    </div>
  );
}
