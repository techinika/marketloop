import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProductCard } from "@/components/ExploreFeed";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { EmptyState } from "@/components/ui/EmptyState";
import { RatingBadge } from "@/components/ui/Rating";
import { HandiDivider } from "@/components/HandiPattern";
import { fetchArtisanProfile } from "@/lib/products";
import { dummyArtisan, dummyProductsByArtisan } from "@/lib/dummyData";
import type { ArtisanProfile } from "@/types";

export const dynamic = "force-dynamic";

function shopNameOf(profile: ArtisanProfile): string {
  const { artisan } = profile;
  return artisan.storeName?.trim() || artisan.name;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Fetch the storefront, falling back to demo data only when the API is empty. */
async function loadStorefront(uid: string): Promise<ArtisanProfile | null> {
  try {
    return await fetchArtisanProfile(uid);
  } catch {
    const demo = dummyArtisan(uid);
    if (!demo) return null;
    return {
      artisan: demo,
      products: dummyProductsByArtisan(uid),
      page: 1,
      pageSize: dummyProductsByArtisan(uid).length,
      hasMore: false,
    };
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ uid: string }>;
}): Promise<Metadata> {
  const { uid } = await params;
  const profile = await loadStorefront(uid);
  if (!profile) {
    return { title: "Artisan not found", robots: { index: false } };
  }
  const name = shopNameOf(profile);
  const description =
    profile.artisan.storeBio?.slice(0, 160) ||
    `Handmade craft by ${name} on Handi.`;
  return {
    title: name,
    description,
    alternates: { canonical: `/artisan/${uid}` },
    openGraph: { title: name, description, url: `/artisan/${uid}`, type: "profile" },
  };
}

export default async function ArtisanPage({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const { uid } = await params;
  const profile = await loadStorefront(uid);
  if (!profile) notFound();

  const { artisan, products } = profile;
  const name = shopNameOf(profile);

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    mainEntity: {
      "@type": "Person",
      name: artisan.name,
      ...(artisan.storeName ? { alternateName: artisan.storeName } : {}),
      ...(artisan.photoUrl ? { image: artisan.photoUrl } : {}),
      ...(artisan.storeRegion
        ? { homeLocation: { "@type": "Place", name: artisan.storeRegion } }
        : {}),
    },
  };

  return (
    <div className="flex-1">
      <JsonLd data={schema} />
      <section className="border-b border-border bg-surface">
        <div className="container-page py-10 sm:py-14">
          <Breadcrumbs
            items={[
              { name: "Home", path: "/" },
              { name: "Artisans", path: "/artisan" },
              { name: name, path: `/artisan/${uid}` },
            ]}
            className="mb-6"
          />
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            {artisan.photoUrl ? (
              <Image
                src={artisan.photoUrl}
                alt={name}
                width={96}
                height={96}
                className="size-24 shrink-0 rounded-full border border-border object-cover"
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex size-24 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xl font-semibold text-accent-strong"
              >
                {initials(name)}
              </span>
            )}

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="heading text-3xl text-foreground sm:text-4xl">{name}</h1>
                {artisan.isVerifiedSeller && (
                  <span className="badge badge-secondary" title="Verified seller">
                    Verified
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-secondary">
                {artisan.storeRegion && <span>{artisan.storeRegion}</span>}
                <RatingBadge avgRating={artisan.avgRating} ratingCount={artisan.ratingCount} />
                {artisan.photoUrl && artisan.name !== name && <span>{artisan.name}</span>}
              </div>

              {artisan.storeBio && (
                <p className="mt-4 max-w-2xl text-base leading-7 text-secondary">
                  {artisan.storeBio}
                </p>
              )}

              {artisan.specialties.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {artisan.specialties.map((specialty) => (
                    <Link
                      key={specialty}
                      href={`/explore?category=${encodeURIComponent(specialty)}`}
                      className="badge badge-neutral transition-colors hover:bg-surface-muted"
                    >
                      {specialty}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="container-page py-10 sm:py-14">
        <div className="flex items-end justify-between gap-4">
          <h2 className="heading text-2xl text-foreground sm:text-3xl">
            Pieces by {name}
          </h2>
          <span className="text-sm text-muted">
            {products.length} {products.length === 1 ? "piece" : "pieces"}
          </span>
        </div>

        <HandiDivider className="mt-4 max-w-6xl" />

        {products.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              icon="package"
              title="No pieces on display yet"
              description={`${name} hasn't published an active listing yet — check back soon.`}
            >
              <Link href="/explore" className="btn btn-secondary">
                Discover other artisans
              </Link>
            </EmptyState>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
