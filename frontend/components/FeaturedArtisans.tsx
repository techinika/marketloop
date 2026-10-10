import Image from "next/image";
import Link from "next/link";

import { RatingBadge } from "@/components/ui/Rating";
import type { ArtisanStorefront } from "@/types";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** One artisan card: avatar, shop identity, region, specialties and reputation. */
export function ArtisanCard({ artisan }: { artisan: ArtisanStorefront }) {
  const shopName = artisan.storeName?.trim() || artisan.name;
  return (
    <Link
      href={`/artisan/${artisan.uid}`}
      className="card-interactive group flex flex-col gap-4 p-5"
    >
      <div className="flex items-center gap-3">
        {artisan.photoUrl ? (
          <Image
            src={artisan.photoUrl}
            alt={shopName}
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-full border border-border object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-strong"
          >
            {initials(shopName)}
          </span>
        )}
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate font-medium text-foreground">
            {shopName}
            {artisan.isVerifiedSeller && (
              <span
                className="text-accent-secondary"
                title="Verified seller"
                aria-label="Verified seller"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden="true">
                  <path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Zm-1 13-3-3 1.4-1.4L11 12.2l4.6-4.6L17 9l-6 6Z" />
                </svg>
              </span>
            )}
          </p>
          {artisan.storeRegion && (
            <p className="truncate text-xs text-muted">{artisan.storeRegion}</p>
          )}
        </div>
      </div>

      {artisan.storeBio && (
        <p className="line-clamp-2 text-sm leading-6 text-secondary">{artisan.storeBio}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        {artisan.specialties.slice(0, 2).map((specialty) => (
          <span key={specialty} className="badge badge-neutral">
            {specialty}
          </span>
        ))}
        <RatingBadge
          avgRating={artisan.avgRating}
          ratingCount={artisan.ratingCount}
          className="ml-auto"
        />
      </div>
    </Link>
  );
}

/** Homepage row of featured shops. */
export function FeaturedArtisans({ artisans }: { artisans: ArtisanStorefront[] }) {
  if (artisans.length === 0) return null;
  return (
    <section id="artisans" className="bg-surface py-14 sm:py-16">
      <div className="container-page">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="badge badge-neutral">The makers</span>
            <h2 className="heading mt-4 text-3xl text-foreground sm:text-4xl">
              Meet the artisans behind the work
            </h2>
            <p className="mt-3 max-w-xl text-base leading-7 text-secondary">
              Every piece on Handi is made by a named maker. Follow a shop, commission a one-off,
              and know exactly whose hands your order passed through.
            </p>
          </div>
          <Link href="/artisan" className="btn btn-secondary">
            All artisans
          </Link>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {artisans.map((artisan) => (
            <ArtisanCard key={artisan.uid} artisan={artisan} />
          ))}
        </div>
      </div>
    </section>
  );
}
