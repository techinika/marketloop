import type { Metadata } from "next";
import Link from "next/link";

import { ArtisanCard } from "@/components/FeaturedArtisans";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { HandiDivider } from "@/components/HandiPattern";
import { EmptyState } from "@/components/ui/EmptyState";
import { DUMMY_ARTISANS } from "@/lib/dummyData";
import { fetchArtisans } from "@/lib/products";
import type { ArtisanStorefront } from "@/types";

// Shops change over time — refresh the prerender rather than freezing it.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Artisan shops — meet the makers",
  description:
    "Browse the Rwandan artisans and studios behind every piece on Handi — weavers, Imigongo artists, carvers and beadworkers, each with a verifiable shop.",
  alternates: { canonical: "/artisan" },
  openGraph: {
    title: "Artisan shops — meet the makers",
    description: "Browse the Rwandan artisans and studios behind every piece on Handi.",
    url: "/artisan",
    type: "website",
  },
};

export default async function ArtisansPage() {
  let artisans: ArtisanStorefront[] = DUMMY_ARTISANS;
  try {
    const real = await fetchArtisans(24);
    if (real.length > 0) artisans = real;
  } catch {
    // API unreachable at request time — fall back to demo shops.
  }

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Artisan shops on Handi",
    description:
      "Rwandan artisans and studios selling handmade craft on Handi — weavers, Imigongo artists, carvers and beadworkers.",
    url: "/artisan",
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
            ]}
          />
          <span className="badge badge-neutral mt-6">The makers</span>
          <h1 className="heading mt-4 text-3xl text-foreground sm:text-4xl">
            Artisan shops
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-secondary">
            Every piece on Handi comes from a named, verifiable maker. Meet the
            weavers, Imigongo artists, carvers and beadworkers behind the work —
            then commission straight from their shop.
          </p>
        </div>
      </section>

      <section className="container-page py-10 sm:py-14">
        <div className="flex items-end justify-between gap-4">
          <h2 className="heading text-2xl text-foreground sm:text-3xl">
            Shops to explore
          </h2>
          <span className="text-sm text-muted">
            {artisans.length} {artisans.length === 1 ? "shop" : "shops"}
          </span>
        </div>

        <HandiDivider className="mt-4 max-w-6xl" />

        {artisans.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              icon="users"
              title="No shops listed yet"
              description="As artisans join Handi their storefronts will appear here."
            >
              <Link href="/sell/new" className="btn btn-secondary">
                Start selling
              </Link>
            </EmptyState>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {artisans.map((artisan) => (
              <ArtisanCard key={artisan.uid} artisan={artisan} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
