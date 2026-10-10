import type { Metadata } from "next";
import Link from "next/link";

import { HeroGallery } from "@/components/HeroGallery";
import { ProductCard } from "@/components/ExploreFeed";
import { FeaturedCategories } from "@/components/FeaturedCategories";
import { FeaturedArtisans } from "@/components/FeaturedArtisans";
import { fetchArtisans, fetchFeed } from "@/lib/products";
import {
  DUMMY_ARTISANS,
  DUMMY_PRODUCTS,
  withDummyProducts,
} from "@/lib/dummyData";
import { HandiDivider } from "@/components/HandiPattern";

export const metadata: Metadata = {
  title: "Handmade Rwandan craft, made for you",
  description:
    "Discover handmade Rwandan craft — baskets, Imigongo art, wood carvings, jewelry and more. Commission a piece made to order, or buy ready to ship, straight from the artisan who made it.",
  alternates: { canonical: "/" },
};

// Featured pieces/artisans are live marketplace data; refresh the prerender
// regularly rather than freezing the build-time snapshot.
export const revalidate = 60;

const STEPS = [
  {
    title: "Discover a piece",
    description:
      "Browse hand-woven baskets, carvings, batiks and more — every piece made by a named Rwandan artisan.",
  },
  {
    title: "Commission or buy",
    description:
      "Order it made to your taste, or grab a finished piece ready to ship. Pay with MoMo or card, held safely in escrow.",
  },
  {
    title: "Receive your handmade work",
    description:
      "Follow the making, confirm delivery, and the payment reaches your artisan. Made by hand, for you.",
  },
];

const TRUST = [
  {
    title: "Escrow on every order",
    description: "Your money is held until you confirm the piece arrived.",
  },
  {
    title: "MoMo & card ready",
    description: "Pay with MTN MoMo, Airtel Money or card — RWF and USD.",
  },
  {
    title: "Named, verified makers",
    description: "Buy from real Rwandan artisans, rated by past buyers.",
  },
];

export default async function Home() {
  let featuredProducts = DUMMY_PRODUCTS.slice(0, 9);
  let artisans = DUMMY_ARTISANS;
  try {
    const [feed, realArtisans] = await Promise.all([
      fetchFeed({ sortBy: "newest", page: 1, pageSize: 9 }),
      fetchArtisans(3),
    ]);
    featuredProducts = withDummyProducts(feed.products, DUMMY_PRODUCTS).slice(0, 9);
    artisans = withDummyProducts(realArtisans, DUMMY_ARTISANS).slice(0, 3);
  } catch {
    // API unreachable at request time — fall back to demo data so the landing
    // page still shows the shape of the marketplace.
  }

  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Handi",
    url: "/",
    description: metadata.description,
  };

  return (
    <div className="flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
      />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border bg-surface">
        <div className="pointer-events-none absolute inset-0 opacity-[0.06]">
          <svg viewBox="0 0 100 100" className="size-full text-ochre" aria-hidden="true">
            <defs>
              <pattern id="hero-motif" width="16" height="16" patternUnits="userSpaceOnUse">
                <g fill="none" stroke="currentColor" strokeWidth="0.5">
                  <path d="M4 12a4 4 0 1 1 4-4" />
                  <path d="M16 2h4M16 14h4" opacity="0.6" />
                </g>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#hero-motif)" />
          </svg>
        </div>
        <div className="container-page relative grid items-center gap-10 py-16 sm:py-20 lg:grid-cols-2 lg:gap-14">
          <div>
            <span className="badge badge-accent">
              <span className="size-1.5 rounded-full bg-accent" />
              Handmade in Rwanda · commissioned directly from artisans
            </span>
            <h1 className="heading mt-5 text-4xl leading-tight text-foreground sm:text-5xl sm:leading-tight">
              Made by hand,{" "}
              <span className="text-accent-strong">made for you.</span>
            </h1>
            <p className="mt-5 max-w-md text-lg leading-8 text-secondary">
              Handi is where Rwandan handiwork finds its people. Commission a
              basket, carving or painting made to order — or fall for a finished
              piece ready to ship. Money stays safe in escrow until your hands
              hold it.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/explore" className="btn btn-primary">
                Discover handmade pieces
              </Link>
              <Link href="/sell/new" className="btn btn-secondary">
                Sell your craft
              </Link>
            </div>
            <p className="mt-6 text-sm text-muted">
              MTN MoMo · Airtel Money · Card · escrow on every order
            </p>
          </div>

          <HeroGallery products={featuredProducts} />
        </div>
      </section>

      {/* Trust strip */}
      <section className="border-b border-border bg-background">
        <div className="container-page grid gap-6 py-8 sm:grid-cols-3">
          {TRUST.map((item) => (
            <div key={item.title} className="flex items-start gap-3">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
                  <path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                <p className="mt-0.5 text-sm leading-6 text-secondary">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <FeaturedCategories limit={6} />

      <HandiDivider className="mx-auto max-w-6xl px-6" />

      {/* How it works */}
      <section id="how-it-works" className="container-page py-14 sm:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <span className="badge badge-neutral">How Handi works</span>
          <h2 className="heading mt-4 text-3xl text-foreground sm:text-4xl">
            Three steps, from loom to doorstep
          </h2>
        </div>

        <ol className="mt-12 grid gap-6 lg:grid-cols-3">
          {STEPS.map((item, i) => (
            <li key={item.title} className="relative rounded-card border border-border bg-surface p-6">
              <span className="heading text-4xl text-accent-strong/25">{`0${i + 1}`}</span>
              <h3 className="heading mt-3 text-lg text-foreground">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-secondary">{item.description}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Featured pieces */}
      {featuredProducts.length > 0 && (
        <section id="features" className="bg-surface py-14 sm:py-16">
          <div className="container-page">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <span className="badge badge-neutral">From the market</span>
                <h2 className="heading mt-4 text-3xl text-foreground sm:text-4xl">
                  Fresh from the hands of artisans
                </h2>
                <p className="mt-3 max-w-xl text-base leading-7 text-secondary">
                  Newest pieces across baskets, art, wood and textiles —
                  each one made in Rwanda.
                </p>
              </div>
              <Link href="/explore" className="btn btn-secondary">
                See everything
              </Link>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {featuredProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Featured artisans */}
      <FeaturedArtisans artisans={artisans} />

      {/* Artisan CTA */}
      <section className="container-page py-14 sm:py-16">
        <div className="card flex flex-col items-center gap-6 bg-gradient-to-br from-accent to-accent-strong p-10 text-center sm:p-14">
          <h2 className="heading max-w-xl text-3xl text-white sm:text-4xl">
            Craft something the world will love
          </h2>
          <p className="max-w-md text-base leading-7 text-accent-soft">
            Share your craft with Rwanda and beyond. List a piece made to order
            or ready to ship, and get paid securely the moment it&apos;s delivered.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/sell/new" className="btn bg-white text-accent-strong hover:bg-accent-soft">
              Sell your craft on Handi
            </Link>
            <Link
              href="/explore"
              className="btn border border-white/40 bg-white/10 text-white hover:bg-white/20"
            >
              Explore the market
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
